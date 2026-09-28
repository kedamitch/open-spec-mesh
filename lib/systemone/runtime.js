import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isLosslessNumber } from 'lossless-json';
import {
  BATCH_PATH, MAX_ITEMS, MAX_REQUEST, MAX_STATE, MODELS, MODELS_PATH, SINGLE_PATH,
  encode, modelRevision, packageRoot, providerConfig, validateAnswers, validateModel, validateProviderQuestions,
} from './contracts.js';
import { guard, prepareQuestions, prepareState } from './policy.js';
import { loadTemplate } from './templates.js';
import { createHttpTransport, ServiceError } from './http.js';
import { writeMetric } from './metrics.js';

export function fallback(reason, itemId) {
  const result = { status: 'fallback', fallback: 'current_actor', reason };
  if (itemId !== undefined && itemId !== null) result.id = itemId;
  return result;
}

function sha256(value) {
  return createHash('sha256').update(encode(value)).digest('hex');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isLosslessNumber(value);
}

function codePointLength(text) {
  return Array.from(text).length;
}


function orderedKeys(value) {
  if (!value || typeof value !== 'object') return [];
  const symbol = Object.getOwnPropertySymbols(value).find((entry) => Array.isArray(value[entry]));
  const recorded = symbol ? value[symbol] : [];
  return [...recorded.filter((key) => Object.hasOwn(value, key)), ...Object.keys(value).filter((key) => !recorded.includes(key))];
}

function mergeContext(context, state) {
  const base = context ?? Object.create(null);
  const keys = orderedKeys(base);
  const seen = new Set(keys);
  for (const key of orderedKeys(state)) if (!seen.has(key)) { seen.add(key); keys.push(key); }
  const merged = Object.create(null);
  for (const key of keys) merged[key] = Object.hasOwn(state, key) ? state[key] : base[key];
  const symbol = [...Object.getOwnPropertySymbols(base), ...Object.getOwnPropertySymbols(state)]
    .find((entry) => Array.isArray(base[entry]) || Array.isArray(state[entry]));
  if (symbol) Object.defineProperty(merged, symbol, { value: keys, enumerable: false });
  return merged;
}

function noSymlinkPath(target) {
  let cursor = path.resolve(target);
  while (true) {
    try { if (lstatSync(cursor).isSymbolicLink()) return false; }
    catch (error) { if (error.code !== 'ENOENT') return false; }
    const parent = path.dirname(cursor);
    if (parent === cursor) return true;
    cursor = parent;
  }
}

export function enabled(configRoot = path.join(packageRoot(), 'mcp')) {
  const settings = path.join(configRoot, 'laya-settings.json');
  if (!noSymlinkPath(settings)) return false;
  try {
    const stat = lstatSync(settings);
    if (!stat.isFile() || stat.size > 1024) return false;
    const value = JSON.parse(readFileSync(settings, 'utf8'));
    return value?.enabled === true;
  } catch { return false; }
}


export class Runtime {
  constructor({ transport, clock = () => performance.now(), wallClock = () => Date.now(), env = process.env, configRoot = path.join(packageRoot(), 'mcp'), root = packageRoot() } = {}) {
    this.env = env;
    this.configRoot = configRoot;
    this.root = root;
    this.transport = transport ?? createHttpTransport({ env });
    this.clock = clock;
    this.wallClock = wallClock;
    this.cache = new Map();
    this.failure = null;
    this.serial = Promise.resolve();
  }

  async exclusive(callback) {
    const previous = this.serial;
    let release;
    this.serial = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await callback(); } finally { release(); }
  }

  async status() {
    if (!enabled(this.configRoot)) return { status: 'disabled' };
    return this.exclusive(async () => {
      try {
        const cfg = providerConfig(this.env);
        if (cfg.provider === 'laya') {
          const result = await this.transport('GET', '/health');
          if (!isRecord(result) || result.status !== 'ok') return fallback('invalid_health');
          const loaded = Array.isArray(result.loaded) ? result.loaded.filter((item) => typeof item === 'string' && MODELS.includes(item)) : [];
          const output = { status: 'ok', provider: 'laya', loaded, health_only: true };
          this.failure = null;
          this.cache.clear();
          return output;
        }
        const result = await this.transport('GET', MODELS_PATH);
        if (!isRecord(result) && !Array.isArray(result)) return fallback('invalid_models');
        const output = { status: 'ok', provider: 'jev', models_only: true };
        this.failure = null;
        this.cache.clear();
        return output;
      } catch (error) {
        if (error instanceof ServiceError || error instanceof TypeError || error instanceof RangeError) return fallback('service_unavailable');
        throw error;
      }
    });
  }

  async predictRequests(requests, provider) {
    if (provider === 'laya') {
      const result = await this.transport('POST', BATCH_PATH, { requests });
      const results = Array.isArray(result) ? result : (isRecord(result) ? result.results : null);
      if (!Array.isArray(results) || results.length !== requests.length) throw new ServiceError('batch_alignment_error');
      return results;
    }
    const results = [];
    for (const request of requests) {
      const result = await this.transport('POST', SINGLE_PATH, request);
      if (!isRecord(result)) throw new ServiceError('invalid_response');
      results.push(result);
    }
    return results;
  }

  async run(decision, items, context = null, model = 'auto') {
    const started = this.clock();
    if (!enabled(this.configRoot)) return fallback('disabled');
    let template; let ids; let states; let cfg; let selectedModel; let questionsByState;
    try {
      template = loadTemplate(decision, { env: this.env, root: this.root });
      if ((context !== null && !isRecord(context)) || !Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
        throw new TypeError('invalid batch');
      }
      ids = [];
      states = [];
      for (const item of items) {
        if (!isRecord(item) || typeof item.id !== 'string' || codePointLength(item.id) < 1 || codePointLength(item.id) > 128) {
          throw new TypeError('invalid item ID');
        }
        if (ids.includes(item.id) || !isRecord(item.state)) throw new TypeError('duplicate ID or invalid state');
        ids.push(item.id);
        states.push(prepareState(template, mergeContext(context, item.state), { root: this.root }));
      }
      if (encode(states).byteLength > MAX_REQUEST) throw new TypeError('batch too large');
      cfg = providerConfig(this.env);
      selectedModel = model === 'auto' || model === '' ? cfg.model : validateModel(cfg.provider, model);
      questionsByState = states.map((state) => prepareQuestions(template, state, { root: this.root }));
      for (const questions of questionsByState) validateProviderQuestions(cfg.provider, questions);
    } catch (error) {
      if (error instanceof Error) return fallback('invalid_configuration_or_input');
      return fallback('invalid_configuration_or_input');
    }

    const revision = modelRevision(cfg.provider, this.env);
    const transportPath = cfg.provider === 'laya' ? BATCH_PATH : SINGLE_PATH;
    const identity = sha256([cfg.provider, cfg.base, cfg.key, selectedModel, revision, transportPath]);
    const scope = sha256([cfg.provider, cfg.base, cfg.key]);
    const keys = states.map((state, index) => sha256([identity, template.digest, state, questionsByState[index]]));
    return this.exclusive(async () => {
      const rows = Array(items.length).fill(null);
      const requestByKey = new Map();
      let cacheHits = 0;
      let networkCalls = 0;
      let backend = 'none';
      for (let index = 0; index < items.length; index += 1) {
        const state = states[index];
        const cacheKey = keys[index];
        if (decision === 'execution-mode@1' && ['quick', 'sdd'].includes(state.existing_mode)) {
          rows[index] = { status: 'ok', recommendation: { mode: state.existing_mode }, basis: 'existing_state' };
          continue;
        }
        if (decision === 'delegation@1' && (!['main', 'architect'].includes(state.current_role) || !state.available_roles.length)) {
          rows[index] = { status: 'ok', recommendation: { executor: state.current_role }, basis: 'role_rule' };
          continue;
        }
        const cached = revision ? this.cache.get(cacheKey) : undefined;
        if (cached && this.clock() - cached.at < 60_000) {
          this.cache.delete(cacheKey);
          this.cache.set(cacheKey, cached);
          rows[index] = this.row(template, state, cached.answers, 'cache');
          cacheHits += 1;
          continue;
        }
        if (!requestByKey.has(cacheKey)) {
          requestByKey.set(cacheKey, { indexes: [], questions: questionsByState[index], request: { state, questions: questionsByState[index], model: selectedModel } });
        }
        requestByKey.get(cacheKey).indexes.push(index);
      }
      const requestEntries = [...requestByKey.values()];
      try {
        if (requestEntries.length) {
          if (this.failure?.scope === scope) throw new ServiceError('circuit_open');
          backend = cfg.provider === 'laya' ? 'server_batch' : 'jev_systemone';
          networkCalls = cfg.provider === 'laya' ? 1 : requestEntries.length;
          const results = await this.predictRequests(requestEntries.map((entry) => entry.request), cfg.provider);
          for (let resultIndex = 0; resultIndex < requestEntries.length; resultIndex += 1) {
            const entry = requestEntries[resultIndex];
            try {
              const answers = validateAnswers(results[resultIndex], entry.questions);
              for (const index of entry.indexes) rows[index] = this.row(template, states[index], answers, 'model');
              if (revision && entry.indexes.every((index) => rows[index]?.status === 'ok')) {
                this.cache.delete(keys[entry.indexes[0]]);
                this.cache.set(keys[entry.indexes[0]], { at: this.clock(), answers });
                while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value);
              }
            } catch (error) {
              if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
              for (const index of entry.indexes) rows[index] = fallback('invalid_response');
            }
          }
        }
      } catch (error) {
        const reason = error instanceof ServiceError ? error.message : 'invalid_request';
        if (reason !== 'circuit_open') this.failure = { scope, reason };
        for (let index = 0; index < rows.length; index += 1) if (rows[index] === null) rows[index] = fallback(reason);
      }
      for (let index = 0; index < rows.length; index += 1) rows[index].id = ids[index];
      const failures = rows.filter((row) => row.status === 'fallback').length;
      const event = {
        schema: 1, time: Math.floor(this.wallClock() / 1000), template_hash: template.digest,
        count: rows.length, cache_hits: cacheHits, network_calls: networkCalls, fallbacks: failures,
        elapsed_ms: Math.round((this.clock() - started) * 100) / 100, backend,
      };
      const written = writeMetric(event, this.env);
      return {
        status: failures === 0 ? 'ok' : failures === rows.length ? 'fallback' : 'partial',
        decision, template_hash: template.digest, advisory: true, results: rows,
        metrics: { elapsed_ms: event.elapsed_ms, network_calls: event.network_calls, cache_hits: event.cache_hits, backend: event.backend },
        metrics_written: written,
      };
    });
  }

  row(template, state, answers, basis) {
    const recommendation = this.guard(template, state, answers);
    if (recommendation === null) return fallback('uncertain_or_disallowed');
    return { status: 'ok', recommendation, basis };
  }

  guard(template, state, answers) {
    return guard(template, state, answers);
  }

  async predict(state, questions, model = 'auto') {
    if (!enabled(this.configRoot)) return fallback('disabled');
    return this.exclusive(async () => {
      let cfg; let selectedModel; let scope;
      try {
        if (!isRecord(state) || codePointLength(encode(state).toString('utf8')) > MAX_STATE) throw new TypeError('invalid state');
        cfg = providerConfig(this.env);
        selectedModel = model === 'auto' || model === '' ? cfg.model : validateModel(cfg.provider, model);
        validateProviderQuestions(cfg.provider, questions);
        scope = sha256([cfg.provider, cfg.base, cfg.key]);
        if (this.failure?.scope === scope) return fallback('circuit_open');
        const result = (await this.predictRequests([{ state, questions, model: selectedModel }], cfg.provider))[0];
        return { answers: validateAnswers(result, questions), advisory: true };
      } catch (error) {
        if (error instanceof ServiceError) {
          if (scope) this.failure = { scope, reason: error.message };
          return fallback(error.message);
        }
        if (error instanceof TypeError || error instanceof RangeError) return fallback('invalid_configuration_input_or_response');
        throw error;
      }
    });
  }
}

export async function runDecision(decision, items, context = null, model = 'auto', options = {}) {
  const runtime = options.runtime ?? new Runtime(options);
  return runtime.run(decision, items, context, model);
}
