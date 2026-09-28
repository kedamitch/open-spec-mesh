import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate, validateRuntimeConfig } from './validate_agents.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'osm-agent-validation-'));
  cpSync(path.join(ROOT, 'AGENTS.md'), path.join(directory, 'AGENTS.md'));
  cpSync(path.join(ROOT, 'config.toml'), path.join(directory, 'config.toml'));
  cpSync(path.join(ROOT, 'agents'), path.join(directory, 'agents'), { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function edit(root, relative, from, to) {
  const file = path.join(root, relative);
  const original = readFileSync(file, 'utf8');
  assert.ok(original.includes(from), `fixture is missing edit anchor: ${from}`);
  writeFileSync(file, original.replace(from, to));
  return original;
}

test('configured Codex V2 roles use canonical model, effort, sandbox, and routing', (t) => {
  assert.deepEqual(validate(fixture(t)), []);
});

test('invalid Main model and missing Multi-Agent V2 are rejected', () => {
  assert.ok(validateRuntimeConfig({ model: 'other', model_reasoning_effort: 'low', features: {} })
    .some((error) => error.includes('Main must use Luna 6 max')));
  assert.ok(validateRuntimeConfig({ model: 'gpt-6-luna', model_reasoning_effort: 'max', features: { multi_agent: true } })
    .some((error) => error.includes('Multi-Agent V2')));
});

test('legacy V1 runtime settings are rejected', () => {
  const errors = validateRuntimeConfig({
    model: 'gpt-6-luna', model_reasoning_effort: 'max',
    features: { multi_agent: true, multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 1, tool_namespace: 'agents', hide_spawn_agent_metadata: false, expose_spawn_agent_model_overrides: false, wait_agent_enabled: true } },
    agents: { enabled: true, max_depth: 3, max_threads: 4, max_concurrent_threads_per_session: 4, default_subagent_model: 'gpt-6-luna', default_subagent_reasoning_effort: 'max' },
  });
  assert.equal(errors.filter((error) => error.includes('Legacy V1 setting')).length, 3);
});

test('dispatch contract remains a common packet and avoids global role routing', (t) => {
  const root = fixture(t);
  edit(root, 'agents/dispatch-contract.md', '不维护全局 Routing Graph', '维护全局 Routing Graph');
  assert.ok(validate(root).some((error) => error.includes('dispatch: local delegation contract')));
  const restored = readFileSync(path.join(root, 'agents/dispatch-contract.md'), 'utf8');
  writeFileSync(path.join(root, 'agents/dispatch-contract.md'), `${restored}\n## 2. SDD 状态与确定性路由\n`);
  assert.ok(validate(root).some((error) => error.includes('global routing topology')));
});

test('Main local delegation authority is linted without importing foreign topology', (t) => {
  const root = fixture(t);
  edit(root, 'AGENTS.md', '## 2. 我的委派', '## 2. 全局路由');
  assert.ok(validate(root).some((error) => error.includes('main: local delegation section missing')));
});

test('role metadata and local delegation policy mutations are rejected', (t) => {
  const root = fixture(t);
  const description = readFileSync(path.join(root, 'agents/explorer.toml'), 'utf8').match(/^description\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(description);
  edit(root, 'config.toml', description, 'drifted role description');
  assert.ok(validate(root).some((error) => error.includes('config description')));

  const architect = readFileSync(path.join(root, 'agents/architect.toml'), 'utf8');
  writeFileSync(path.join(root, 'agents/architect.toml'), architect.replace('调用方不应重新拆分', '调用方可以重新拆分'));
  assert.ok(validate(root).some((error) => error.includes('planning ownership')));
  writeFileSync(path.join(root, 'agents/architect.toml'), architect.replace('你不实现代码、不做最终验收。', '你可以委派 Worker 处理实现。你不实现代码、不做最终验收。'));
  assert.ok(validate(root).some((error) => error.includes('unauthorized delegation authority')));

  const worker = readFileSync(path.join(root, 'agents/worker.toml'), 'utf8');
  writeFileSync(path.join(root, 'agents/worker.toml'), worker.replaceAll('不可委派任何 Agent', '可以委派 Explorer'));
  assert.ok(validate(root).some((error) => error.includes('leaf no-delegation')));
  assert.ok(validate(root).some((error) => error.includes('unauthorized delegation authority')));
});

test('leaf roles cannot hide positive delegation authority in a list', (t) => {
  const root = fixture(t);
  edit(root, 'agents/worker.toml', '\n"""', '\n你只可委派：\n- Explorer\n"""');
  assert.ok(validate(root).some((error) => error.includes('worker: unauthorized delegation authority')));
});

test('harmless role handoff references are not treated as delegation authority', (t) => {
  const root = fixture(t);
  edit(root, 'agents/worker.toml', '最终集成验证由 Main 统一执行。', '最终集成验证由 Main 统一执行；Worker 不负责最终归档。');
  assert.deepEqual(validate(root), []);
});

test('Quick and explicit-user SDD mode boundaries remain enforced', (t) => {
  const root = fixture(t);
  const worker = readFileSync(path.join(root, 'agents/worker.toml'), 'utf8');
  writeFileSync(path.join(root, 'agents/worker.toml'), worker.replace('mode=quick 或缺少 Contract 时返回 permission_denied。', 'Quick 可以执行。'));
  assert.ok(validate(root).some((error) => error.includes('Quick prohibition')));
  writeFileSync(path.join(root, 'agents/worker.toml'), worker);

  const reviewer = readFileSync(path.join(root, 'agents/reviewer.toml'), 'utf8');
  writeFileSync(path.join(root, 'agents/reviewer.toml'), reviewer.replace('仅执行 mode=sdd 且用户明确要求', '仅执行 mode=sdd'));
  assert.ok(validate(root).some((error) => error.includes('explicit-user SDD')));
});

test('role model, effort, permissions, and local multi-agent switches are validated', (t) => {
  const root = fixture(t);
  const architectPath = path.join(root, 'agents/architect.toml');
  const originalArchitect = readFileSync(architectPath, 'utf8');
  for (const [from, to] of [['gpt-6-sol', 'gpt-6-luna'], ['xhigh', 'high'], ['workspace-write', 'read-only'], ['fork_turns="none"', 'fork_turns="all"']]) {
    writeFileSync(architectPath, originalArchitect.replace(from, to));
    assert.ok(validate(root).length > 0);
  }
  writeFileSync(architectPath, originalArchitect);
  const workerPath = path.join(root, 'agents/worker.toml');
  writeFileSync(workerPath, `${readFileSync(workerPath, 'utf8')}\n[agents]\nenabled=false\n`);
  assert.ok(validate(root).length > 0);
});
