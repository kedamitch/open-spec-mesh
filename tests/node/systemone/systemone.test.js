import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { isLosslessNumber } from 'lossless-json';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  BATCH_PATH, FORWARDED_ENV, MAX_RESPONSE, MODELS_PATH, SINGLE_PATH, TOOL_SCHEMAS,
  LosslessStdioTransport, Runtime, ServiceError, config, createHttpTransport, enabled, encode, fallback, guard,
  isManagedLaunchShape, listTemplates, loadTemplate, managedLaunchShape,
  prepareQuestions, prepareState, providerConfig, validateAnswers, validateQuestions,
} from '../../..//lib/systemone/index.js';
import { parseLosslessJson, legacyJson } from '../../..//lib/runtime/compat-json.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MCP_ENTRY = path.join(ROOT, 'mcp/laya_http_mcp.js');
const SOURCE_CONFIG = path.join(ROOT, 'mcp');
const MODE_QUESTIONS = loadTemplate('execution-mode@1').questions;
const answer = (choice) => ({ answers: { mode: { type: 'choice', choice } } });

function tempDir(prefix = 'systemone-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function enabledConfig(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'laya-settings.json'), '{"enabled":true}\n', { mode: 0o600 });
  return directory;
}

function layaEnv(extra = {}) {
  return {
    SYSTEMONE_PROVIDER: '',
    LAYA_BASE_URL: 'https://laya.example.invalid/',
    LAYA_API_KEY: 'test-client-secret',
    LAYA_MODEL_REVISION: 'test-revision',
    ...extra,
  };
}

function runtimeWith(transport, { env = layaEnv(), configRoot = SOURCE_CONFIG, clock, wallClock } = {}) {
  return new Runtime({ transport, env, configRoot, root: ROOT, clock, wallClock });
}

function callText(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content?.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

function noSystemOneEnv() {
  const env = { ...process.env };
  for (const name of FORWARDED_ENV) delete env[name];
  return env;
}

test('provider config defaults to Laya, keeps Jev explicit, and validates safe URLs/keys/models/timeouts', () => {
  const laya = providerConfig({ LAYA_BASE_URL: 'https://laya.example.invalid/v1///', LAYA_API_KEY: 'token' });
  assert.deepEqual(laya, { provider: 'laya', base: 'https://laya.example.invalid/v1', key: 'token', model: 'multilingual', timeout: 5 });
  assert.deepEqual(config({ LAYA_BASE_URL: 'http://localhost:8000/', LAYA_API_KEY: 't', LAYA_TIMEOUT_SECONDS: '2.5' }), ['http://localhost:8000', 't', 'multilingual', 2.5]);
  assert.throws(() => providerConfig({ TYPESAFE_API_KEY: 'jev-secret' }), /LAYA_BASE_URL/);
  const jev = providerConfig({ SYSTEMONE_PROVIDER: ' JeV ', TYPESAFE_API_KEY: 'jev-token' });
  assert.equal(jev.provider, 'jev');
  assert.equal(jev.base, 'https://api.typesafe.ai');
  assert.equal(jev.model, 'jev-latest');
  assert.equal(jev.timeout, 10);
  for (const base of ['http://user:secret@host', 'http://host:bad', 'file:///tmp/a', 'https://host/?key=secret', 'http://host/#frag', 'http://host/\nheader']) {
    assert.throws(() => providerConfig({ LAYA_BASE_URL: base, LAYA_API_KEY: 'key' }));
  }
  assert.throws(() => providerConfig({ LAYA_BASE_URL: 'https://host', LAYA_API_KEY: 'secret key' }), /printable ASCII/);
  assert.throws(() => providerConfig({ LAYA_BASE_URL: 'https://host', LAYA_API_KEY: 'x', LAYA_MODEL: 'unlisted' }), /supported checkpoint/);
  assert.throws(() => providerConfig({ LAYA_BASE_URL: 'https://host', LAYA_API_KEY: 'x', SYSTEMONE_TIMEOUT_SECONDS: '61' }), /between 0.1 and 60/);
  assert.throws(() => providerConfig({ SYSTEMONE_PROVIDER: 'jev', TYPESAFE_API_KEY: 'x', TYPESAFE_BASE_URL: 'https://u:p@host' }), /absolute http/);
});

test('template validation, digest, path restrictions, permissions and answer guard preserve advisory boundaries', () => {
  const templates = listTemplates({ root: ROOT });
  assert.deepEqual(templates.map((item) => item.id), ['delegation@1', 'execution-mode@1']);
  const mode = loadTemplate('execution-mode@1', { root: ROOT });
  assert.match(mode.digest, /^[0-9a-f]{64}$/u);
  assert.throws(() => loadTemplate('../execution-mode@1', { root: ROOT }), /name@version/);
  assert.throws(() => validateQuestions({ choice: { type: 'choice', instructions: 'Pick', criteria: [''] } }), /labels/);
  assert.throws(() => validateQuestions({ score: { type: 'score', instructions: 'Rank', criteria: ['only one'] } }), /2-20/);
  const clean = validateAnswers(answer('quick'), MODE_QUESTIONS);
  assert.deepEqual(clean.mode, { type: 'choice', choice: 'quick' });
  assert.throws(() => validateAnswers(answer('architect'), MODE_QUESTIONS), /candidate/);

  const state = prepareState(loadTemplate('delegation@1'), {
    request: 'ask', current_role: ' Main ', execution_mode: ' SDD ',
    task_graph_ready: true, reviewer_requested: true,
    available_roles: ['worker', 'architect', 'explorer', 'librarian', 'reviewer', 'worker'],
  }, { root: ROOT });
  assert.deepEqual(state.available_roles, ['worker', 'architect', 'explorer', 'librarian', 'reviewer']);
  const questions = prepareQuestions(loadTemplate('delegation@1'), state, { root: ROOT });
  assert.deepEqual(Object.keys(questions.executor.criteria), ['main', 'worker', 'architect', 'explorer', 'librarian', 'reviewer', 'uncertain']);
  assert.equal(typeof questions.executor.criteria.worker, 'string');
  assert.equal(questions.executor.criteria.worker.length > 0, true);
  assert.equal(prepareState(loadTemplate('delegation@1'), {
    request: 'ask', current_role: 'worker', available_roles: ['main', 'reviewer'], execution_mode: 'sdd',
  }, { root: ROOT }).available_roles.length, 0);
  assert.throws(() => prepareState(mode, { request: 'x'.repeat(5000) }, { root: ROOT }), /state too large/);

  const temp = tempDir();
  try {
    const custom = { id: 'custom-kind@1', description: 'custom', required_fields: ['failure'], questions: { kind: { type: 'choice', instructions: 'classify', criteria: ['dependency', 'uncertain'] } } };
    writeFileSync(path.join(temp, 'custom-kind.v1.json'), JSON.stringify(custom));
    assert.equal(loadTemplate('custom-kind@1', { root: ROOT, env: { LAYA_TEMPLATE_DIR: temp } }).id, custom.id);
    const link = path.join(temp, 'evil.v1.json');
    symlinkSync(path.join(ROOT, 'mcp/templates/execution-mode.v1.json'), link);
    assert.throws(() => loadTemplate('evil@1', { root: ROOT, env: { LAYA_TEMPLATE_DIR: temp } }), /unknown decision|symlink/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('role permission matrix, local descriptions, executor guard, normalization, and order preserve non-escalation', () => {
  const template = loadTemplate('delegation@1');
  const allowed = (actor, mode, extras = {}) => prepareState(template, {
    request: 'known facts', current_role: actor, execution_mode: mode,
    available_roles: ['reviewer', 'worker', 'architect', 'explorer', 'librarian'], ...extras,
  }, { root: ROOT }).available_roles;
  assert.deepEqual(allowed('main', 'quick', { task_graph_ready: true, reviewer_requested: true }), ['explorer', 'librarian']);
  assert.deepEqual(allowed('main', 'sdd', { task_graph_ready: false, reviewer_requested: true }), ['architect', 'explorer', 'librarian']);
  assert.deepEqual(allowed('main', 'sdd', { task_graph_ready: true }), ['worker', 'architect', 'explorer', 'librarian']);
  assert.deepEqual(allowed('main', 'sdd', { task_graph_ready: true, reviewer_requested: true }), ['reviewer', 'worker', 'architect', 'explorer', 'librarian']);
  assert.deepEqual(allowed('architect', 'sdd'), ['explorer', 'librarian']);
  for (const actor of ['worker', 'explorer', 'librarian', 'reviewer']) assert.deepEqual(allowed(actor, 'sdd'), []);

  const architect = prepareState(template, { request: 'need facts', current_role: 'architect', execution_mode: 'sdd', available_roles: ['worker', 'librarian', 'explorer'] }, { root: ROOT });
  const questions = prepareQuestions(template, architect, { root: ROOT });
  assert.deepEqual(Object.keys(questions.executor.criteria), ['architect', 'librarian', 'explorer', 'uncertain']);
  assert.equal(questions.executor.instructions.includes('Explorer'), true);
  assert.equal(questions.executor.instructions.includes('Librarian'), true);
  assert.deepEqual(guard(template, architect, { executor: { type: 'choice', choice: 'explorer' } }), { executor: 'explorer' });
  assert.equal(guard(template, architect, { executor: { type: 'choice', choice: 'worker' } }), null);
  assert.equal(guard(template, architect, { executor: { type: 'choice', choice: 'uncertain' } }), null);
});

test('lossless compatibility preserves Unicode, integer precision, float kind, negative zero and insertion order', () => {
  const text = '{"state":{"request":"雪🛠","numeric":{"9007199254740993":9007199254740993,"2":2,"float":1.0,"negative_zero":-0.0}},"list":[1e20]}';
  const value = parseLosslessJson(text);
  const encoded = legacyJson(value, { ensureAscii: false, separators: [',', ':'] });
  assert.equal(encoded, text.replace('1e20', '1e+20'));
  assert.equal(isLosslessNumber(value.state.numeric['9007199254740993']), true);
  assert.equal(encode(value).toString('utf8'), text.replace('1e20', '1e+20'));
});

test('baseline Python MCP tool schemas and wire vectors stay golden, with all 42 legacy client decisions mapped', () => {
  const fixtureRoot = path.join(ROOT, 'tests/fixtures/migration/systemone');
  const toolsGolden = JSON.parse(readFileSync(path.join(fixtureRoot, 'tool-schema.golden.json'), 'utf8'));
  assert.equal(toolsGolden.schema, 1);
  assert.deepEqual(TOOL_SCHEMAS, toolsGolden.tools);
  const wireGolden = parseLosslessJson(readFileSync(path.join(fixtureRoot, 'wire-golden.json'), 'utf8'));
  assert.equal(wireGolden.vectors.length, 4);
  for (const vector of wireGolden.vectors) {
    assert.equal(legacyJson(vector.value, { ensureAscii: false, separators: [',', ':'] }), vector.encoded, vector.name);
  }
  const map = JSON.parse(readFileSync(path.join(fixtureRoot, 'case-map.json'), 'utf8'));
  assert.equal(map.legacy_decisions_cases.length, 42);
  assert.equal(new Set(map.legacy_decisions_cases.map((entry) => entry.source)).size, 42);
  assert.equal(map.legacy_decisions_cases.filter((entry) => entry.owner_task === 'C03-04').length, 31);
  assert.equal(map.legacy_decisions_cases.filter((entry) => entry.owner_task === 'C03-05').length, 11);
  assert.equal(map.legacy_mcp_client_cases.length, 4);
  assert.equal(map.independent_gpu_factory_cases.length, 5);
  assert.equal(map.deferred_verification.owner_task, 'C03-06');
});

test('prototype-named state, question, answer and candidate keys stay inert data properties', () => {
  const stateInput = parseLosslessJson('{"request":"keep going","__proto__":{"polluted":true},"constructor":"ordinary","toString":"ordinary"}');
  const state = prepareState(loadTemplate('execution-mode@1'), stateInput, { root: ROOT });
  assert.equal(Object.getPrototypeOf(state), null);
  assert.equal(Object.hasOwn(state, '__proto__'), true);
  assert.equal({}.polluted, undefined);
  const questions = parseLosslessJson('{"__proto__":{"type":"choice","instructions":"Choose","criteria":{"ordinary":"safe"}}}');
  validateQuestions(questions);
  const parsed = parseLosslessJson('{"answers":{"__proto__":{"type":"choice","choice":"ordinary"}}}');
  const answers = validateAnswers(parsed, questions);
  assert.equal(Object.getPrototypeOf(answers), null);
  assert.equal(Object.hasOwn(answers, '__proto__'), true);
  assert.equal(legacyJson(answers, { ensureAscii: false, separators: [',', ':'] }), '{"__proto__":{"type":"choice","choice":"ordinary"}}');
});

test('clientConfig and managed launch shape are shared, explicit, and do not claim custom MCP entries', () => {
  const shape = managedLaunchShape('/home/test/.codex/mcp/laya_http_mcp.js', '/usr/bin/node');
  assert.deepEqual(shape, { command: '/usr/bin/node', args: ['/home/test/.codex/mcp/laya_http_mcp.js'], env_vars: FORWARDED_ENV });
  assert.equal(isManagedLaunchShape(shape), true);
  assert.equal(isManagedLaunchShape({ command: '/usr/bin/python3', args: ['/home/test/.codex/mcp/laya_http_mcp.py'] }), true);
  assert.equal(isManagedLaunchShape({ command: '/usr/bin/node', args: ['/home/test/mcp/custom.js'] }), false);
  assert.equal(isManagedLaunchShape({ command: '/usr/bin/node', args: ['/home/test/.codex/mcp/laya_http_mcp.js', '--custom'] }), false);
  assert.equal(FORWARDED_ENV.includes('LAYA_BATCH_PATH'), false);
});

test('disabled System One returns before provider configuration or HTTP and settings fail closed', async () => {
  const directory = tempDir();
  try {
    writeFileSync(path.join(directory, 'laya-settings.json'), '{"enabled":false}');
    let calls = 0;
    const env = new Proxy({}, { get() { throw new Error('disabled path read provider environment'); } });
    const runtime = runtimeWith(async () => { calls += 1; }, { env, configRoot: directory });
    assert.deepEqual(await runtime.status(), { status: 'disabled' });
    assert.deepEqual(await runtime.run('execution-mode@1', [{ id: 'a', state: { request: 'x' } }]), fallback('disabled'));
    assert.deepEqual(await runtime.predict({}, {}), fallback('disabled'));
    assert.equal(calls, 0);
    unlinkSync(path.join(directory, 'laya-settings.json'));
    symlinkSync(path.join(ROOT, 'mcp/laya-settings.json'), path.join(directory, 'laya-settings.json'));
    assert.equal(enabled(directory), false);
    unlinkSync(path.join(directory, 'laya-settings.json'));
    writeFileSync(path.join(directory, 'laya-settings.json'), 'x'.repeat(1025));
    assert.equal(enabled(directory), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Laya sends a true batch (including one item), accepts native list/envelope, deduplicates and uses pinned cache only', async () => {
  const calls = [];
  const transport = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    return { results: body.requests.map(() => answer('quick')) };
  };
  let now = 0;
  const runtime = runtimeWith(transport, { clock: () => now, wallClock: () => 1_700_000_000_000 });
  const items = [
    { id: 'one', state: { request: 'same' } },
    { id: 'two', state: { request: 'same' } },
  ];
  const first = await runtime.run('execution-mode@1', items);
  assert.equal(first.status, 'ok');
  assert.equal(first.metrics.backend, 'server_batch');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].endpoint, BATCH_PATH);
  assert.equal(calls[0].body.requests.length, 1);
  assert.equal(calls[0].body.requests[0].model, 'multilingual');
  assert.deepEqual(first.results.map((row) => row.id), ['one', 'two']);

  await runtime.run('execution-mode@1', items);
  assert.equal(calls.length, 1);
  assert.equal((await runtime.run('execution-mode@1', [{ id: 'three', state: { request: 'different' } }])).status, 'ok');
  assert.equal(calls.length, 2);
  now = 61_000;
  await runtime.run('execution-mode@1', items);
  assert.equal(calls.length, 3);
  runtime.env.LAYA_MODEL_REVISION = 'replacement-revision';
  await runtime.run('execution-mode@1', items);
  assert.equal(calls.length, 4);
  runtime.env.LAYA_MODEL = 'english';
  await runtime.run('execution-mode@1', items);
  assert.equal(calls.length, 5);

  const noPinCalls = [];
  const noPin = runtimeWith(async (method, endpoint, body) => { noPinCalls.push([method, endpoint, body]); return [{ answers: { mode: { type: 'choice', choice: 'sdd' } } }]; }, { env: { LAYA_BASE_URL: 'https://laya.example.invalid', LAYA_API_KEY: 'key' } });
  await noPin.run('execution-mode@1', [{ id: 'a', state: { request: 'one' } }]);
  await noPin.run('execution-mode@1', [{ id: 'b', state: { request: 'one' } }]);
  assert.equal(noPinCalls.length, 2);
});

test('native Laya raw-list envelope and typed numeric answers remain valid', async () => {
  const rawList = runtimeWith(async () => [answer('sdd')]);
  const result = await rawList.run('execution-mode@1', [{ id: 'raw', state: { request: 'not already decided' } }]);
  assert.equal(result.results[0].recommendation.mode, 'sdd');

  const questions = parseLosslessJson('{"score":{"type":"score","instructions":"Rank","criteria":["low","high"]},"kind":{"type":"choice","instructions":"Select","criteria":{"1":"first","2":"second"}}}');
  const answers = parseLosslessJson('{"answers":{"score":{"type":"score","score":1.0,"confidence":0.7,"probabilities":{"0":0.25,"1":0.75}},"kind":{"type":"choice","choice":"1"}}}');
  const clean = validateAnswers(answers, questions);
  assert.equal(clean.score.score.toString(), '1.0');
  assert.equal(clean.score.confidence.toString(), '0.7');
  assert.deepEqual(Object.keys(clean.score.probabilities), ['0', '1']);
});

test('Jev is explicit single-state transport, rule rows bypass inference, and no provider fallback is automatic', async () => {
  const calls = [];
  const runtime = runtimeWith(async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    return { answers: { mode: { type: 'choice', choice: 'sdd' } } };
  }, { env: { SYSTEMONE_PROVIDER: 'jev', TYPESAFE_API_KEY: 'jev-secret' } });
  const out = await runtime.run('execution-mode@1', [
    { id: 'known', state: { request: 'known', existing_mode: 'quick' } },
    { id: 'a', state: { request: 'first' } },
    { id: 'b', state: { request: 'second' } },
  ]);
  assert.equal(out.status, 'ok');
  assert.equal(out.results[0].basis, 'existing_state');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.endpoint), [SINGLE_PATH, SINGLE_PATH]);
  assert.deepEqual(calls.map((call) => call.body.model), ['jev-latest', 'jev-latest']);
  assert.equal(calls[0].body.state.request, 'first');
  assert.equal(MODELS_PATH, '/v1/models');
});

test('partial responses preserve valid IDs; malformed, uncertain, misaligned and unavailable results fallback safely', async () => {
  const runtime = runtimeWith(async () => ({ results: [answer('quick'), { answers: { mode: { type: 'choice', choice: 'not-allowed' } } }] }));
  const partial = await runtime.run('execution-mode@1', [
    { id: 'good', state: { request: 'good' } }, { id: 'bad', state: { request: 'bad' } },
  ]);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.results[0].recommendation.mode, 'quick');
  assert.equal(partial.results[1].id, 'bad');
  assert.equal(partial.results[1].reason, 'invalid_response');

  const uncertain = runtimeWith(async () => ({ results: [answer('uncertain')] }));
  assert.equal((await uncertain.run('execution-mode@1', [{ id: 'x', state: { request: 'x' } }])).results[0].reason, 'uncertain_or_disallowed');
  const misaligned = runtimeWith(async () => ({ results: [] }));
  assert.equal((await misaligned.run('execution-mode@1', [{ id: 'x', state: { request: 'x' } }])).results[0].reason, 'batch_alignment_error');
  const brokenCalls = [];
  const broken = runtimeWith(async (...args) => { brokenCalls.push(args); throw new ServiceError('http_503'); });
  await broken.run('execution-mode@1', [{ id: 'a', state: { request: 'a' } }]);
  assert.equal(brokenCalls[0][1], BATCH_PATH);
  assert.equal((await broken.run('execution-mode@1', [{ id: 'b', state: { request: 'b' } }])).results[0].reason, 'circuit_open');
  await broken.predict({ request: 'x' }, MODE_QUESTIONS);
  assert.equal(brokenCalls.length, 1);
  broken.transport = async () => ({ status: 'ok', loaded: [] });
  assert.equal((await broken.status()).status, 'ok');
  broken.transport = async (...args) => { brokenCalls.push(args); throw new ServiceError('http_503'); };
  await broken.run('execution-mode@1', [{ id: 'c', state: { request: 'c' } }]);
  assert.equal(brokenCalls.length, 2);
});

test('input validation and permission rules short-circuit before any transport', async () => {
  const calls = [];
  const runtime = runtimeWith(async (...args) => { calls.push(args); return { results: [] }; });
  for (const [decision, items] of [
    ['execution-mode@1', []], ['execution-mode@1', Array.from({ length: 17 }, (_, index) => ({ id: String(index), state: { request: 'x' } }))],
    ['execution-mode@1', [{ id: 'x', state: {} }]], ['execution-mode@1', [{ id: 'x', state: { request: 'x' } }, { id: 'x', state: { request: 'y' } }]],
    ['execution-mode@1', [{ id: 'x', state: { request: 'x'.repeat(5000) } }]], ['missing@1', [{ id: 'x', state: { request: 'x' } }]],
  ]) assert.equal((await runtime.run(decision, items)).status, 'fallback');
  const immediate = await runtime.run('delegation@1', [{ id: 'leaf', state: { request: 'known', current_role: 'worker', available_roles: ['main'], execution_mode: 'sdd' } }]);
  assert.equal(immediate.results[0].recommendation.executor, 'worker');
  assert.equal(immediate.results[0].basis, 'role_rule');
  assert.equal(calls.length, 0);
});

test('HTTP transport bounds request/response, rejects redirects, respects timeout, parses losslessly and hides credentials', async () => {
  const env = layaEnv({ LAYA_BASE_URL: 'https://laya.example.invalid', LAYA_TIMEOUT_SECONDS: '0.1' });
  let seen;
  const okTransport = createHttpTransport({ env, fetchImpl: async (url, options) => {
    seen = { url, options };
    return new Response('{"number":9007199254740993,"float":1.0}', { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const parsed = await okTransport('POST', BATCH_PATH, { requests: [] });
  assert.equal(seen.url, `https://laya.example.invalid${BATCH_PATH}`);
  assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.headers.Authorization, 'Bearer test-client-secret');
  assert.equal(parsed.number.toString(), '9007199254740993');
  assert.equal(parsed.float.toString(), '1.0');
  await assert.rejects(() => okTransport('POST', BATCH_PATH, { value: 'x'.repeat(MAX_RESPONSE) }), (error) => error instanceof TypeError && error.message === 'request_too_large');

  const redirect = createHttpTransport({ env, fetchImpl: async (_url, options) => { assert.equal(options.redirect, 'error'); throw new TypeError('unexpected redirect to https://token-secret.example'); } });
  await assert.rejects(() => redirect('GET', '/health'), (error) => error instanceof ServiceError && error.message === 'redirect_rejected');
  const badJson = createHttpTransport({ env, fetchImpl: async () => new Response('{bad', { status: 200 }) });
  await assert.rejects(() => badJson('GET', '/health'), (error) => error.message === 'invalid_json');
  const health = createHttpTransport({ env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://laya.example.invalid/health');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    return new Response('{"status":"ok","loaded":["multilingual"]}', { status: 200 });
  } });
  assert.equal((await health('GET', '/health')).status, 'ok');
  const unauthorized = createHttpTransport({ env, fetchImpl: async () => new Response('secret must not be reflected', { status: 401 }) });
  await assert.rejects(() => unauthorized('GET', '/health'), (error) => error.message === 'http_401' && !error.message.includes('test-client-secret'));
  const tooLarge = createHttpTransport({ env, fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }) });
  await assert.rejects(() => tooLarge('GET', '/health'), (error) => error.message === 'response_too_large');
  const timeout = createHttpTransport({ env, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })) });
  await assert.rejects(() => timeout('GET', '/health'), (error) => error.message === 'unavailable_or_timeout');
});

test('metrics are private, redacted and non-blocking on write failure', async () => {
  const directory = tempDir();
  try {
    const metrics = path.join(directory, 'private', 'metrics.jsonl');
    const runtime = runtimeWith(async () => ({ results: [answer('quick')] }), { env: layaEnv({ SYSTEMONE_METRICS_PATH: metrics }) });
    const result = await runtime.run('execution-mode@1', [{ id: 'private-id', state: { request: 'private request text' } }]);
    assert.equal(result.status, 'ok');
    assert.equal(result.metrics_written, true);
    assert.equal(statSync(metrics).mode & 0o777, 0o600);
    const text = readFileSync(metrics, 'utf8');
    for (const secret of ['private-id', 'private request text', 'test-client-secret']) assert.equal(text.includes(secret), false);
    assert.equal(JSON.parse(text).network_calls, 1);
    const failed = runtimeWith(async () => ({ results: [answer('quick')] }), { env: layaEnv({ SYSTEMONE_METRICS_PATH: 'relative.jsonl' }) });
    assert.equal((await failed.run('execution-mode@1', [{ id: 'x', state: { request: 'safe' } }])).status, 'ok');
    assert.equal((await failed.run('execution-mode@1', [{ id: 'y', state: { request: 'safe' } }])).metrics_written, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('single --input mode is explicit, bounded, emits JSON only, and runs with a Node-only PATH', async () => {
  const temp = tempDir();
  try {
    const valid = path.join(temp, 'request.json');
    const invalid = path.join(temp, 'invalid.json');
    writeFileSync(valid, '{"decision":"execution-mode@1","items":[{"id":"x","state":{"request":"local"}}]}');
    writeFileSync(invalid, '{');
    const env = noSystemOneEnv();
    env.PATH = path.dirname(process.execPath);
    const validResult = spawnSync(process.execPath, [MCP_ENTRY, '--input', valid], { cwd: temp, env, encoding: 'utf8' });
    assert.equal(validResult.status, 0);
    assert.equal(validResult.stderr, '');
    assert.equal(JSON.parse(validResult.stdout).reason, 'invalid_configuration_or_input');
    const invalidResult = spawnSync(process.execPath, [MCP_ENTRY, '--input', invalid], { cwd: temp, env, encoding: 'utf8' });
    assert.equal(invalidResult.status, 0);
    assert.deepEqual(JSON.parse(invalidResult.stdout), fallback('invalid_input_file'));
    const badArgs = spawnSync(process.execPath, [MCP_ENTRY, '--not-a-flag'], { cwd: temp, env, encoding: 'utf8' });
    assert.equal(badArgs.status, 2);
    assert.equal(badArgs.stdout, '');
    assert.match(badArgs.stderr, /unsupported System One argument/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('real SDK client lists and calls all four low-level MCP tools over stdio with legacy text envelopes', async () => {
  const env = noSystemOneEnv();
  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_ENTRY], cwd: ROOT, env, stderr: 'pipe' });
  const client = new Client({ name: 'systemone-contract-test', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ['laya_status', 'laya_templates', 'laya_decide', 'laya_predict']);
    assert.deepEqual(listed.tools.map((tool) => tool.inputSchema), TOOL_SCHEMAS.map((tool) => tool.inputSchema));
    const templates = callText(await client.callTool({ name: 'laya_templates', arguments: {} }));
    assert.equal(templates.templates.length, 2);
    const status = callText(await client.callTool({ name: 'laya_status', arguments: {} }));
    assert.equal(status.status, 'fallback');
    const decision = callText(await client.callTool({ name: 'laya_decide', arguments: { decision: 'execution-mode@1', items: [{ id: 'x', state: { request: 'safe' } }] } }));
    assert.equal(decision.status, 'fallback');
    const prediction = callText(await client.callTool({ name: 'laya_predict', arguments: { state: { request: 'safe' }, questions: { kind: { type: 'choice', instructions: 'Select', criteria: ['a', 'uncertain'] } } } }));
    assert.equal(prediction.status, 'fallback');
  } finally { await client.close().catch(() => {}); }
});

test('installed thin wrapper resolves Home/mcp settings and the adjacent runtime without relying on cwd', async () => {
  const temp = tempDir('systemone-installed-');
  try {
    const home = path.join(temp, '.codex');
    const mcp = path.join(home, 'mcp');
    const runtimeRoot = path.join(home, 'open-spec-mesh', 'runtime');
    mkdirSync(mcp, { recursive: true });
    mkdirSync(path.join(runtimeRoot, 'lib'), { recursive: true });
    const cp = await import('node:fs/promises');
    await cp.cp(path.join(ROOT, 'lib/systemone'), path.join(runtimeRoot, 'lib/systemone'), { recursive: true });
    await cp.cp(path.join(ROOT, 'lib/runtime'), path.join(runtimeRoot, 'lib/runtime'), { recursive: true });
    await cp.cp(path.join(ROOT, 'mcp/templates'), path.join(runtimeRoot, 'mcp/templates'), { recursive: true });
    await cp.cp(path.join(ROOT, 'agents'), path.join(runtimeRoot, 'agents'), { recursive: true });
    await cp.cp(path.join(ROOT, 'package.json'), path.join(runtimeRoot, 'package.json'));
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(runtimeRoot, 'node_modules'), 'dir');
    await cp.cp(MCP_ENTRY, path.join(mcp, 'laya_http_mcp.js'));
    writeFileSync(path.join(mcp, 'laya-settings.json'), '{"enabled":false}\n');
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(mcp, 'laya_http_mcp.js')], cwd: os.tmpdir(), env: noSystemOneEnv(), stderr: 'pipe' });
    const client = new Client({ name: 'installed-layout-test', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 4);
      assert.deepEqual(callText(await client.callTool({ name: 'laya_templates', arguments: {} })), fallback('disabled'));
    } finally { await client.close().catch(() => {}); }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('stdio lossless transport preserves unsafe numeric IDs and exact JSON number tokens through HTTP', async () => {
  const requests = [];
  const api = http.createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    requests.push(text);
    const value = parseLosslessJson(text);
    const count = value.requests.length;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ results: Array.from({ length: count }, () => answer('quick')) }));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [MCP_ENTRY], {
    cwd: os.tmpdir(),
    env: { ...noSystemOneEnv(), LAYA_BASE_URL: `http://127.0.0.1:${api.address().port}`, LAYA_API_KEY: 'raw-frame-secret', SYSTEMONE_MODEL_REVISION: 'raw-frame-test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  const messages = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line) messages.push(parseLosslessJson(line));
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const waitFor = async (predicate) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 5000) throw new Error(`timed out waiting for MCP frame; stderr=${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const send = (text) => child.stdin.write(`${text}\n`);
  try {
    send('{"jsonrpc":"2.0","id":10,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"raw","version":"1"}}}');
    await waitFor(() => messages.some((message) => message.id?.toString() === '10'));
    send('{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}');
    const args = (id, request) => `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"laya_decide","arguments":{"decision":"execution-mode@1","items":[{"id":"${request}","state":{"request":"${request}","facts":{"9007199254740993":9007199254740993,"2":2,"float":1.0,"negative_zero":-0.0}}}]}}}`;
    send(args('9007199254740993', 'raw-one'));
    send(args('9007199254740995', 'raw-two'));
    await waitFor(() => ['9007199254740993', '9007199254740995'].every((id) => messages.some((message) => message.id?.toString() === id)));
    for (const exact of ['9007199254740993', '"float":1.0', '"negative_zero":-0.0']) {
      assert.equal(requests.some((body) => body.includes(exact)), true, `missing exact token ${exact}`);
    }
    assert.equal(stderr.includes('raw-frame-secret'), false);
    const returned = messages.filter((message) => ['9007199254740993', '9007199254740995'].includes(message.id?.toString()));
    assert.equal(returned.length, 2);
    for (const message of returned) assert.equal(message.result.content[0].text.includes('"status":"ok"'), true);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
    await new Promise((resolve) => api.close(resolve));
  }
});

test('malformed stdio frames produce a protocol parse error without stack traces or stdout noise', async () => {
  const child = spawn(process.execPath, [MCP_ENTRY], { cwd: ROOT, env: noSystemOneEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  try {
    child.stdin.write('{bad-json}\n');
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('parse error response timed out')), 2000);
      const poll = setInterval(() => {
        if (output.includes('"code":-32700')) { clearTimeout(deadline); clearInterval(poll); resolve(); }
      }, 10);
    });
    assert.equal(stderr.includes('SyntaxError'), false);
    assert.equal(output.trim().split('\n').length, 1);
  } finally { child.kill('SIGTERM'); await once(child, 'exit').catch(() => {}); }
});

test('stdio rejects an oversized trailing partial frame after a complete frame in the same chunk', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const transport = new LosslessStdioTransport(stdin, stdout, stderr);
  let failure;
  transport.onerror = (error) => { failure = error; };
  await transport.start();
  stdin.write(Buffer.concat([
    Buffer.from('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'),
    Buffer.alloc(10 * 1024 * 1024 + 1, 0x78),
  ]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failure?.message, 'stdio message exceeds the maximum size');
  assert.equal(transport.started, false);
  stdin.destroy(); stdout.destroy(); stderr.destroy();
});

test('npm consumer file list excludes the standalone GPU Python server and helper', () => {
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` };
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const artifact = JSON.parse(result.stdout)[0];
  const files = artifact.files.map((entry) => entry.path.replaceAll('\\', '/'));
  assert.equal(files.some((name) => name === 'integrations/laya-gpu/contracts.py' || name.startsWith('integrations/laya-gpu/')), false);
  assert.equal(files.includes('mcp/laya_batch_server.py'), false);
});

test('GPU server Python dependencies stay out of the Node client path list', () => {
  assert.deepEqual(TOOL_SCHEMAS.map((tool) => tool.name), ['laya_status', 'laya_templates', 'laya_decide', 'laya_predict']);
  assert.equal(MODE_QUESTIONS.mode.type, 'choice');
});
