import { isLosslessNumber } from 'lossless-json';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyJson, parseLosslessJson } from '../runtime/compat-json.js';

export const MODELS = Object.freeze(['english', 'multilingual', 'typed-decisions']);
export const PROVIDERS = Object.freeze(['laya', 'jev']);
export const SINGLE_PATH = '/v1/systemone';
export const BATCH_PATH = '/v1/systemone/batch';
export const MODELS_PATH = '/v1/models';
export const MAX_ITEMS = 16;
export const MAX_REQUEST = 128 * 1024;
export const MAX_RESPONSE = 1024 * 1024;
export const MAX_STATE = 4096;
export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_JEV_MODEL = 'jev-latest';
export const DEFAULT_LAYA_MODEL = 'multilingual';

export const FORWARDED_ENV = Object.freeze([
  'SYSTEMONE_PROVIDER', 'SYSTEMONE_TIMEOUT_SECONDS', 'SYSTEMONE_MODEL_REVISION',
  'SYSTEMONE_METRICS_PATH', 'LAYA_BASE_URL', 'LAYA_API_KEY', 'LAYA_MODEL',
  'LAYA_MODEL_REVISION', 'LAYA_TIMEOUT_SECONDS', 'LAYA_TEMPLATE_DIR',
  'LAYA_METRICS_PATH', 'TYPESAFE_API_KEY', 'TYPESAFE_BASE_URL',
  'TYPESAFE_DEFAULT_MODEL',
]);

export const OPTIONAL_ENV = Object.freeze([
  'SYSTEMONE_PROVIDER', 'SYSTEMONE_TIMEOUT_SECONDS', 'SYSTEMONE_MODEL_REVISION',
  'SYSTEMONE_METRICS_PATH', 'LAYA_MODEL', 'LAYA_MODEL_REVISION',
  'LAYA_TIMEOUT_SECONDS', 'LAYA_TEMPLATE_DIR', 'LAYA_METRICS_PATH',
  'TYPESAFE_BASE_URL', 'TYPESAFE_DEFAULT_MODEL',
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const TOOL_SCHEMAS = deepFreeze([
  {
    "name": "laya_status",
    "description": "Explicit troubleshooting only. Uses Laya /health or Jev /v1/models; neither proves inference quality.",
    "inputSchema": {
      "properties": {},
      "type": "object",
      "title": "statusArguments"
    }
  },
  {
    "name": "laya_templates",
    "description": "List locally available versioned decisions and required fields; no model/network call.",
    "inputSchema": {
      "properties": {},
      "type": "object",
      "title": "templatesArguments"
    }
  },
  {
    "name": "laya_decide",
    "description": "Reuse one named judgment over 1-16 inputs. Do not rewrite questions each time.\n\n        decision: execution-mode@1 or delegation@1 (or an operator-installed custom template).\n        items: [{id: unique string, state: {request: original request, ...}}].\n        context: shared existing facts; item.state overrides matching context fields.\n        delegation@1 needs current_role and available_roles; execution_mode defaults to quick.\n        Do not summarize long context solely to invoke this tool. Prefer direct judgment for\n        obvious/one-off work. Returns per-ID recommendations or fallback; partial keeps valid IDs.\n        No agent spawning, approvals, model changes or acceptance. Quick / SDD remain advisory routing choices.\n        Laya inference uses /v1/systemone/batch. Jev uses the official /v1/systemone endpoint\n        once per distinct state. On fallback continue the original actor's workflow.\n        ",
    "inputSchema": {
      "properties": {
        "decision": {
          "title": "Decision",
          "type": "string"
        },
        "items": {
          "items": {
            "additionalProperties": true,
            "type": "object"
          },
          "title": "Items",
          "type": "array"
        },
        "context": {
          "anyOf": [
            {
              "additionalProperties": true,
              "type": "object"
            },
            {
              "type": "null"
            }
          ],
          "default": null,
          "title": "Context"
        },
        "model": {
          "default": "auto",
          "title": "Model",
          "type": "string"
        }
      },
      "required": [
        "decision",
        "items"
      ],
      "type": "object",
      "title": "decideArguments"
    }
  },
  {
    "name": "laya_predict",
    "description": "Prototype a NEW reusable judgment, not the default for every decision.\n\n        questions={id:{type:'choice'|'score'|'noul',instructions:string,criteria:...}}.\n        choice criteria map <=20 labels to descriptions; score uses ordered descriptions;\n        noul omits criteria or uses true/false descriptions. No text generation. Validate on\n        representative data then store a versioned JSON template for repeated execution.\n        auto uses the selected provider default: LAYA_MODEL/multilingual or\n        TYPESAFE_DEFAULT_MODEL/jev-latest. Fallback means the current actor continues.\n        ",
    "inputSchema": {
      "properties": {
        "state": {
          "additionalProperties": true,
          "title": "State",
          "type": "object"
        },
        "questions": {
          "additionalProperties": true,
          "title": "Questions",
          "type": "object"
        },
        "model": {
          "default": "auto",
          "title": "Model",
          "type": "string"
        }
      },
      "required": [
        "state",
        "questions"
      ],
      "type": "object",
      "title": "predictArguments"
    }
  }
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '../..');

export function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && !isLosslessNumber(value);
}

export function orderedKeys(value) {
  if (!value || typeof value !== 'object') return [];
  const orderSymbol = Object.getOwnPropertySymbols(value).find((symbol) => Array.isArray(value[symbol]));
  const recorded = orderSymbol ? value[orderSymbol] : [];
  return [...recorded.filter((key) => Object.hasOwn(value, key)), ...Object.keys(value).filter((key) => !recorded.includes(key))];
}

export function orderedEntries(value) {
  return orderedKeys(value).map((key) => [key, value[key]]);
}

function compact(value) {
  return legacyJson(value, { ensureAscii: false, separators: [',', ':'] });
}

export function encode(value) {
  return Buffer.from(compact(value), 'utf8');
}

export function parseJsonLossless(text) {
  return parseLosslessJson(text);
}

export function codePointLength(value) {
  return Array.from(value).length;
}

function hasSymlinkInPath(target) {
  let cursor = path.resolve(target);
  while (true) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

export function readSafeFile(filename, maxBytes, label) {
  if (hasSymlinkInPath(filename)) throw new Error(`${label} symlinks are not allowed`);
  const stat = lstatSync(filename);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  if (stat.size > maxBytes) throw new Error(`${label} too large`);
  return readFileSync(filename);
}

function toStringRecord(value) {
  return isJsonObject(value) ? value : null;
}

function asNumber(value) {
  if (typeof value === 'number') return value;
  if (value && value.isLosslessNumber === true) return Number(value.toString());
  return NaN;
}

function isFiniteJsonNumber(value) {
  const number = asNumber(value);
  return Number.isFinite(number);
}

export function resolveProvider(env = process.env) {
  const explicit = String(env.SYSTEMONE_PROVIDER ?? '').trim().toLowerCase();
  if (!explicit) return 'laya';
  if (!PROVIDERS.includes(explicit)) throw new TypeError('SYSTEMONE_PROVIDER must be laya or jev');
  return explicit;
}

function validateBase(base, name) {
  let parsed;
  try { parsed = new URL(base); } catch { parsed = null; }
  const valid = parsed && ['http:', 'https:'].includes(parsed.protocol)
    && Boolean(parsed.hostname) && !parsed.username && !parsed.password
    && !parsed.search && !parsed.hash
    && !/[\s\u0000-\u001f\u007f]/u.test(base) && !base.includes('\\');
  if (!valid) throw new TypeError(`${name} must be an absolute http(s) URL without credentials, query or fragment`);
  return base.replace(/\/+$/u, '');
}

function validateKey(key, name) {
  if (!key || [...key].some((char) => char.codePointAt(0) < 33 || char.codePointAt(0) > 126)) {
    throw new TypeError(`${name} must be a printable ASCII token without whitespace`);
  }
  return key;
}

export function validateModel(provider, model) {
  if (typeof model !== 'string') throw new TypeError('model must be a string');
  const normalized = model.trim();
  if (!normalized || normalized.length > 128 || /[^\x21-\x7e]/u.test(normalized)) {
    throw new TypeError('model must be a nonempty printable ASCII identifier');
  }
  if (provider === 'laya' && !MODELS.includes(normalized)) throw new TypeError('LAYA_MODEL must name a supported checkpoint');
  return normalized;
}

function parseTimeout(raw) {
  const text = String(raw ?? '').trim();
  const validNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text);
  const timeout = validNumber ? Number(text) : NaN;
  if (!Number.isFinite(timeout) || timeout < 0.1 || timeout > 60) {
    throw new TypeError('SYSTEMONE_TIMEOUT_SECONDS must be between 0.1 and 60');
  }
  return timeout;
}

export function providerConfig(env = process.env) {
  const provider = resolveProvider(env);
  let base; let key; let model; let timeoutRaw;
  if (provider === 'laya') {
    const missing = ['LAYA_BASE_URL', 'LAYA_API_KEY'].filter((name) => !String(env[name] ?? '').trim());
    if (missing.length) throw new TypeError(`Missing required environment variables: ${missing.join(', ')}`);
    base = validateBase(String(env.LAYA_BASE_URL).trim(), 'LAYA_BASE_URL');
    key = validateKey(String(env.LAYA_API_KEY).trim(), 'LAYA_API_KEY');
    model = validateModel('laya', String(env.LAYA_MODEL ?? DEFAULT_LAYA_MODEL).trim() || DEFAULT_LAYA_MODEL);
    timeoutRaw = String(env.SYSTEMONE_TIMEOUT_SECONDS ?? '').trim() || String(env.LAYA_TIMEOUT_SECONDS ?? '5');
  } else {
    if (!String(env.TYPESAFE_API_KEY ?? '').trim()) {
      throw new TypeError('Missing required environment variables: TYPESAFE_API_KEY');
    }
    base = validateBase(String(env.TYPESAFE_BASE_URL ?? DEFAULT_JEV_BASE_URL).trim() || DEFAULT_JEV_BASE_URL, 'TYPESAFE_BASE_URL');
    key = validateKey(String(env.TYPESAFE_API_KEY).trim(), 'TYPESAFE_API_KEY');
    model = validateModel('jev', String(env.TYPESAFE_DEFAULT_MODEL ?? DEFAULT_JEV_MODEL).trim() || DEFAULT_JEV_MODEL);
    timeoutRaw = String(env.SYSTEMONE_TIMEOUT_SECONDS ?? '').trim() || '10';
  }
  return { provider, base, key, model, timeout: parseTimeout(timeoutRaw) };
}

export function config(env = process.env) {
  const value = providerConfig(env);
  return [value.base, value.key, value.model, value.timeout];
}

export function modelRevision(provider, env = process.env) {
  const generic = String(env.SYSTEMONE_MODEL_REVISION ?? '').trim();
  if (generic) return generic;
  return provider === 'laya' ? String(env.LAYA_MODEL_REVISION ?? '').trim() : '';
}

export function metricsPath(env = process.env) {
  return String(env.SYSTEMONE_METRICS_PATH ?? '').trim() || String(env.LAYA_METRICS_PATH ?? '').trim();
}

export function validateQuestions(questions) {
  if (!isJsonObject(questions) || Object.keys(questions).length < 1 || Object.keys(questions).length > 8) {
    throw new TypeError('questions must contain 1-8 typed judgments');
  }
  for (const [name, q] of orderedEntries(questions)) {
    if (!name || !isJsonObject(q)) throw new TypeError('invalid question name or definition');
    if (typeof q.instructions !== 'string' || !q.instructions.trim()) throw new TypeError('instructions must be a nonempty string');
    const { type, criteria } = q;
    if (type === 'choice') {
      if (!(isJsonObject(criteria) || Array.isArray(criteria)) || orderedKeys(criteria).length < 1 || orderedKeys(criteria).length > 20) {
        throw new TypeError('choice requires 1-20 candidates');
      }
      const labels = Array.isArray(criteria) ? criteria : orderedKeys(criteria);
      if (labels.some((key) => typeof key !== 'string' || !key.trim()) || new Set(labels).size !== labels.length) {
        throw new TypeError('choice labels must be unique nonempty strings');
      }
      if (isJsonObject(criteria) && orderedKeys(criteria).some((key) => criteria[key] !== null && typeof criteria[key] !== 'string')) {
        throw new TypeError('choice descriptions must be strings or null');
      }
    } else if (type === 'score') {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 20
        || criteria.some((value) => typeof value !== 'string' || !value.trim())) {
        throw new TypeError('score requires 2-20 ordered descriptions');
      }
    } else if (type === 'noul') {
      if (criteria !== undefined && criteria !== null) {
        if (!isJsonObject(criteria) || orderedKeys(criteria).some((key) => !['true', 'false'].includes(key))
          || orderedKeys(criteria).some((key) => typeof criteria[key] !== 'string')) {
          throw new TypeError('noul criteria use true/false string descriptions');
        }
      }
    } else {
      throw new TypeError('unknown question type');
    }
  }
  if (encode(questions).byteLength > 16384) throw new TypeError('question schema too large');
}

export function validateProviderQuestions(provider, questions) {
  validateQuestions(questions);
  if (provider === 'jev') {
    for (const [, question] of orderedEntries(questions)) {
      if (question.type === 'score' && question.criteria.length > 10) {
        throw new TypeError('Jev score requires at most 10 ordered descriptions');
      }
    }
  }
}

export function validateAnswers(result, questions) {
  const answers = isJsonObject(result) ? toStringRecord(result.answers) : null;
  if (!answers) throw new TypeError('missing answers');
  const clean = Object.create(null);
  for (const [name, q] of orderedEntries(questions)) {
    const answer = toStringRecord(answers[name]);
    const kind = q.type;
    if (!answer || answer.type !== kind) throw new TypeError('missing or mismatched answer');
    const value = answer[kind];
    if (kind === 'choice') {
      const labels = Array.isArray(q.criteria) ? q.criteria : orderedKeys(q.criteria);
      if (typeof value !== 'string' || !labels.includes(value)) throw new TypeError('unknown answer candidate');
    } else {
      const maximum = kind === 'score' ? q.criteria.length - 1 : 1;
      const number = asNumber(value);
      if (!isFiniteJsonNumber(value) || number < 0 || number > maximum) throw new TypeError('invalid numeric answer');
    }
    clean[name] = { type: kind, [kind]: value };
    for (const field of ['confidence', 'answer_confidence']) {
      const confidence = answer[field];
      const number = asNumber(confidence);
      if (isFiniteJsonNumber(confidence) && number >= 0 && number <= 1) clean[name][field] = confidence;
    }
    const probabilities = toStringRecord(answer.probabilities);
    if ((kind === 'choice' || kind === 'score') && probabilities) {
      const labels = kind === 'choice' ? (Array.isArray(q.criteria) ? q.criteria : orderedKeys(q.criteria))
        : q.criteria.map((_, index) => String(index));
      const probabilityKeys = orderedKeys(probabilities);
      const values = probabilityKeys.map((key) => probabilities[key]);
      if (probabilityKeys.length === labels.length && labels.every((label) => Object.hasOwn(probabilities, label))
        && values.every((entry) => isFiniteJsonNumber(entry) && asNumber(entry) >= 0 && asNumber(entry) <= 1)
        && Math.abs(values.reduce((sum, entry) => sum + asNumber(entry), 0) - 1) < 0.02) {
        const ordered = Object.create(null);
        for (const label of labels) ordered[label] = probabilities[label];
        clean[name].probabilities = ordered;
      }
    }
  }
  return clean;
}

export function packageRoot() {
  return PACKAGE_ROOT;
}

export function clientConfig({ env = process.env, packageRoot: root = PACKAGE_ROOT, configRoot = path.join(root, 'mcp') } = {}) {
  return Object.freeze({
    enabled: readEnabled(configRoot),
    provider: String(env.SYSTEMONE_PROVIDER ?? '').trim().toLowerCase() || 'laya',
    packageRoot: root,
    configRoot,
    templatesRoot: path.join(root, 'mcp', 'templates'),
    settingsPath: path.join(configRoot, 'laya-settings.json'),
    forwardedEnv: FORWARDED_ENV,
    defaults: Object.freeze({ layaModel: DEFAULT_LAYA_MODEL, jevModel: DEFAULT_JEV_MODEL, jevBaseUrl: DEFAULT_JEV_BASE_URL, layaTimeoutSeconds: 5, jevTimeoutSeconds: 10 }),
  });
}

export function managedLaunchShape(entryPath, nodePath = process.execPath) {
  if (typeof entryPath !== 'string' || !path.isAbsolute(entryPath)) throw new TypeError('managed MCP entry must be an absolute path');
  return Object.freeze({ command: nodePath, args: Object.freeze([entryPath]), env_vars: FORWARDED_ENV });
}

export function isManagedLaunchShape({ command, args } = {}) {
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string') return false;
  const base = path.basename(args[0]);
  const normalized = args[0].replaceAll('\\', '/');
  const inMcpDirectory = /(?:^|\/)mcp\/(?:laya_http_mcp\.(?:py|js))$/u.test(normalized);
  if (!inMcpDirectory) return false;
  const executable = path.basename(String(command ?? '')).toLowerCase();
  return base.endsWith('.js') ? ['node', 'node.exe'].includes(executable)
    : base.endsWith('.py') && /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/u.test(executable);
}

export function readEnabled(configRoot) {
  const filename = path.join(configRoot, 'laya-settings.json');
  try {
    const bytes = readSafeFile(filename, 1024, 'settings');
    const value = JSON.parse(bytes.toString('utf8'));
    return value?.enabled === true;
  } catch { return false; }
}
