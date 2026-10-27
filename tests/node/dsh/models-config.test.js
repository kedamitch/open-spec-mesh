import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_MODELS, getModelsConfigPath, loadModelsConfig, loadModelsConfigWithDiagnostics,
} from '../../../lib/installation/models-config.js';
import { apply, buildRoleRoutesSection } from '../../../dsh/gatekeeper.mjs';

function tempHome(t, prefix = 'osm-models-') {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('缺少 osm-models.json 时使用默认路由且 problems 为空', (t) => {
  const home = tempHome(t);
  const { config, problems, filePath } = loadModelsConfigWithDiagnostics(home);
  assert.deepEqual(problems, []);
  assert.equal(filePath, path.join(home, 'osm-models.json'));
  assert.deepEqual(config, DEFAULT_MODELS);
  for (const route of Object.values(config)) {
    assert.ok(route.provider && route.model && route.reasoningEffort);
  }
});

test('osm-models.json 解析失败时 problems 非空且整体回退默认', (t) => {
  const home = tempHome(t);
  writeFileSync(getModelsConfigPath(home), '{ not json');
  const { config, problems } = loadModelsConfigWithDiagnostics(home);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /解析失败/u);
  assert.deepEqual(config, DEFAULT_MODELS);
});

test('角色按字段深合并：只写 worker.model 时 provider 与 effort 仍取默认', (t) => {
  const home = tempHome(t);
  writeFileSync(getModelsConfigPath(home), JSON.stringify({ worker: { model: 'w-1' } }));
  const { config, problems } = loadModelsConfigWithDiagnostics(home);
  assert.equal(config.worker.model, 'w-1');
  assert.equal(config.worker.provider, DEFAULT_MODELS.worker.provider);
  assert.equal(config.worker.reasoningEffort, DEFAULT_MODELS.worker.reasoningEffort);
  assert.deepEqual(config.explorer, DEFAULT_MODELS.explorer);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /worker 缺少 provider/u);
});

test('未知角色与非法角色项都记入 problems', (t) => {
  const home = tempHome(t);
  writeFileSync(getModelsConfigPath(home), JSON.stringify({ ghost: { provider: 'a', model: 'b' }, explorer: 'oops' }));
  const { config, problems } = loadModelsConfigWithDiagnostics(home);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /未知角色 ghost/u);
  assert.match(problems.join('\n'), /explorer 的配置必须是对象/u);
  assert.deepEqual(config.explorer, DEFAULT_MODELS.explorer);
});

test('loadModelsConfig 保持兼容签名且补全 description', (t) => {
  const home = tempHome(t);
  writeFileSync(getModelsConfigPath(home), JSON.stringify({ reviewer: { provider: 'acme', model: 'r-1', reasoningEffort: 'max' } }));
  const config = loadModelsConfig(home);
  assert.equal(config.reviewer.model, 'r-1');
  assert.equal(config.reviewer.description, DEFAULT_MODELS.reviewer.description);
});

test('buildRoleRoutesSection 把 problems 追加成一条显式告警', () => {
  const text = buildRoleRoutesSection({ worker: { provider: 'a', model: 'b', reasoningEffort: 'high' } }, ['osm-models.json 解析失败: x']);
  assert.match(text, /\| worker \| a \| b \| high \|/u);
  assert.match(text, /^⚠ osm-models\.json 解析失败: x；/mu);
  assert.equal(buildRoleRoutesSection({ worker: { provider: 'a', model: 'b' } }).includes('⚠'), false);
});

test('apply 注册的路由表在配置损坏时带上 problems 告警行', async (t) => {
  const home = tempHome(t);
  writeFileSync(getModelsConfigPath(home), '{ broken');
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; });
  const sections = new Map();
  await apply({ systemPrompt: { section: (section) => sections.set(section.name, section) }, on: () => {} }, {});
  const section = sections.get('osm:role-routes');
  assert.ok(section);
  const text = section.text();
  const { provider, model, reasoningEffort } = DEFAULT_MODELS.worker;
  assert.ok(text.includes(`| worker | ${provider} | ${model} | ${reasoningEffort} |`));
  assert.match(text, /⚠ osm-models\.json 解析失败/u);
});
