import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_MODELS, VALID_REASONING_EFFORTS, diagnoseModelsConfig, exportModelsConfig, getModelsConfigPath, importModelsConfig, loadModelsConfig, loadModelsConfigWithDiagnostics,
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
  writeFileSync(getModelsConfigPath(home), JSON.stringify({ worker: { provider: 'acme', model: 'r-1', reasoningEffort: 'max' } }));
  const config = loadModelsConfig(home);
  assert.equal(config.worker.model, 'r-1');
  assert.equal(config.worker.description, DEFAULT_MODELS.worker.description);
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

test('VALID_REASONING_EFFORTS 包含标准档位且只读', () => {
  assert.ok(Array.isArray(VALID_REASONING_EFFORTS));
  assert.ok(VALID_REASONING_EFFORTS.includes('none'));
  assert.ok(VALID_REASONING_EFFORTS.includes('low'));
  assert.ok(VALID_REASONING_EFFORTS.includes('medium'));
  assert.ok(VALID_REASONING_EFFORTS.includes('high'));
  assert.ok(VALID_REASONING_EFFORTS.includes('xhigh'));
  assert.ok(VALID_REASONING_EFFORTS.includes('max'));
  assert.ok(VALID_REASONING_EFFORTS.includes('default'));
  assert.throws(() => { VALID_REASONING_EFFORTS.push('illegal'); });
});

test('diagnoseModelsConfig: 缺失文件时整体为 ok 且 exitCode 为 0', (t) => {
  const home = tempHome(t);
  const report = diagnoseModelsConfig(home);
  assert.equal(report.exists, false);
  assert.equal(report.validJson, true);
  assert.equal(report.topLevelObject, true);
  assert.equal(report.overallStatus, 'ok');
  assert.equal(report.exitCode, 0);
  assert.equal(report.globalIssues.length, 0);
  assert.equal(Object.keys(report.roles).length, 4);
  for (const role of Object.keys(DEFAULT_MODELS)) {
    assert.equal(report.roles[role].configured, false);
    assert.equal(report.roles[role].status, 'ok');
    assert.equal(report.roles[role].provider, DEFAULT_MODELS[role].provider);
  }
});

test('diagnoseModelsConfig: 语法损坏与顶层非对象时 exitCode 为 1', (t) => {
  const home = tempHome(t);
  writeFileSync(getModelsConfigPath(home), '{ broken json');
  const reportBroken = diagnoseModelsConfig(home);
  assert.equal(reportBroken.exists, true);
  assert.equal(reportBroken.validJson, false);
  assert.equal(reportBroken.overallStatus, 'error');
  assert.equal(reportBroken.exitCode, 1);
  assert.ok(reportBroken.suggestions.includes('osm models reset'));

  writeFileSync(getModelsConfigPath(home), '["not", "an", "object"]');
  const reportArr = diagnoseModelsConfig(home);
  assert.equal(reportArr.validJson, true);
  assert.equal(reportArr.topLevelObject, false);
  assert.equal(reportArr.overallStatus, 'error');
  assert.equal(reportArr.exitCode, 1);
  assert.ok(reportArr.suggestions.includes('osm models reset'));
});

test('diagnoseModelsConfig: 合规配置且全角色覆盖时状态全部为 OK 且 exitCode 为 0', (t) => {
  const home = tempHome(t);
  const validConfig = {
    architect: { provider: 'p1', model: 'm1', reasoningEffort: 'xhigh' },
    worker: { provider: 'p2', model: 'm2', reasoningEffort: 'max' },
    explorer: { provider: 'p3', model: 'm3', reasoningEffort: 'low' },
    librarian: { provider: 'p4', model: 'm4', reasoningEffort: 'default' },
  };
  writeFileSync(getModelsConfigPath(home), JSON.stringify(validConfig));
  const report = diagnoseModelsConfig(home);
  assert.equal(report.overallStatus, 'ok');
  assert.equal(report.exitCode, 0);
  assert.equal(report.globalIssues.length, 0);
  assert.equal(report.suggestions.length, 0);
  for (const role of ['architect', 'worker', 'explorer', 'librarian']) {
    assert.equal(report.roles[role].status, 'ok');
    assert.equal(report.roles[role].configured, true);
    assert.equal(report.roles[role].issues.length, 0);
  }
});

test('diagnoseModelsConfig: 字段缺失与非法档位时精确指出问题并给出建议，exitCode 为 1', (t) => {
  const home = tempHome(t);
  const badConfig = {
    architect: { provider: 'p1', model: 'm1', reasoningEffort: 'xhigh' },
    worker: { provider: '', model: 'm2', reasoningEffort: 'invalid-effort' },
    explorer: { provider: 'p3' }, // 缺少 model
    // librarian 未配置
  };
  writeFileSync(getModelsConfigPath(home), JSON.stringify(badConfig));
  const report = diagnoseModelsConfig(home);
  assert.equal(report.overallStatus, 'error');
  assert.equal(report.exitCode, 1);

  assert.equal(report.roles.architect.status, 'ok');

  // worker 检查
  assert.equal(report.roles.worker.status, 'error');
  assert.ok(report.roles.worker.issues.some((i) => i.includes('缺少必填字段 provider')));
  assert.ok(report.roles.worker.issues.some((i) => i.includes('非法')));
  assert.ok(report.roles.worker.suggestions.length > 0);

  // explorer 检查
  assert.equal(report.roles.explorer.status, 'error');
  assert.ok(report.roles.explorer.issues.some((i) => i.includes('缺少必填字段 model')));

  // librarian 未配置，状态应为 default，不阻断
  assert.equal(report.roles.librarian.status, 'default');
  assert.equal(report.roles.librarian.configured, false);
});

test('exportModelsConfig: 默认导出路径为当前工作区下的 osm-models-backup.json', (t) => {
  const home = tempHome(t);
  const defaultRes = exportModelsConfig(null, home);
  const expectedDefaultPath = path.resolve(process.cwd(), 'osm-models-backup.json');
  t.after(() => rmSync(expectedDefaultPath, { force: true }));
  assert.equal(defaultRes.success, true);
  assert.equal(defaultRes.targetPath, expectedDefaultPath);
  assert.deepEqual(defaultRes.config, DEFAULT_MODELS);
  assert.ok(existsSync(expectedDefaultPath));
  assert.equal(readFileSync(expectedDefaultPath, 'utf8'), JSON.stringify(DEFAULT_MODELS, null, 2) + '\n');
});

test('exportModelsConfig: 自定义目标路径且递归创建不存在的父目录', (t) => {
  const home = tempHome(t);
  const customTarget = path.join(home, 'nested', 'deep', 'backup-models.json');
  const customRes = exportModelsConfig(customTarget, home);
  assert.equal(customRes.success, true);
  assert.equal(customRes.targetPath, customTarget);
  assert.ok(existsSync(customTarget));
  assert.equal(readFileSync(customTarget, 'utf8'), JSON.stringify(DEFAULT_MODELS, null, 2) + '\n');
});

test('importModelsConfig: 目标不存在时成功导入', (t) => {
  const home = tempHome(t);
  const sourceFile = path.join(home, 'source.json');
  const validConfig = {
    architect: { provider: 'fatfei-codex', model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' },
    worker: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' },
    explorer: { provider: 'fatfei', model: 'gemini-3.8-flash-high', reasoningEffort: 'high' },
    librarian: { provider: 'fatfei', model: 'gemini-3.8-flash-high', reasoningEffort: 'high' },
  };
  writeFileSync(sourceFile, JSON.stringify(validConfig, null, 2));

  const targetPath = getModelsConfigPath(home);
  assert.equal(existsSync(targetPath), false);

  const res = importModelsConfig(sourceFile, {}, home);
  assert.equal(res.success, true);
  assert.equal(res.targetPath, targetPath);
  assert.equal(res.count, 4);
  assert.deepEqual(res.config.worker, validConfig.worker);
  assert.ok(existsSync(targetPath));

  const loaded = loadModelsConfig(home);
  assert.equal(loaded.worker.model, 'deepseek-v4.1-flash');
});

test('importModelsConfig: 目标已存在且无 force 时拦截（原文件保持不变）', (t) => {
  const home = tempHome(t);
  const targetPath = getModelsConfigPath(home);
  const originalConfig = {
    architect: { provider: 'orig-p', model: 'orig-m', reasoningEffort: 'low' },
    worker: { provider: 'orig-w', model: 'orig-m', reasoningEffort: 'low' },
    explorer: { provider: 'orig-e', model: 'orig-m', reasoningEffort: 'low' },
    librarian: { provider: 'orig-l', model: 'orig-m', reasoningEffort: 'low' },
  };
  writeFileSync(targetPath, JSON.stringify(originalConfig, null, 2));

  const sourceFile = path.join(home, 'new-source.json');
  const newConfig = {
    architect: { provider: 'new-p', model: 'new-m', reasoningEffort: 'high' },
    worker: { provider: 'new-w', model: 'new-m', reasoningEffort: 'high' },
    explorer: { provider: 'new-e', model: 'new-m', reasoningEffort: 'high' },
    librarian: { provider: 'new-l', model: 'new-m', reasoningEffort: 'high' },
  };
  writeFileSync(sourceFile, JSON.stringify(newConfig, null, 2));

  const res = importModelsConfig(sourceFile, {}, home);
  assert.equal(res.success, false);
  assert.equal(res.blocked, true);
  assert.equal(res.targetPath, targetPath);
  assert.equal(res.reason, '目标配置文件已存在 (~/.dsh/osm-models.json)，若需覆盖请追加 --force 选项。');

  // 原配置保持不变
  const loaded = JSON.parse(readFileSync(targetPath, 'utf8'));
  assert.equal(loaded.architect.provider, 'orig-p');
});

test('importModelsConfig: 目标已存在且 force: true 时成功覆盖', (t) => {
  const home = tempHome(t);
  const targetPath = getModelsConfigPath(home);
  const originalConfig = {
    architect: { provider: 'orig-p', model: 'orig-m' },
    worker: { provider: 'orig-w', model: 'orig-m' },
    explorer: { provider: 'orig-e', model: 'orig-m' },
    librarian: { provider: 'orig-l', model: 'orig-m' },
  };
  writeFileSync(targetPath, JSON.stringify(originalConfig, null, 2));

  const sourceFile = path.join(home, 'force-source.json');
  const forceConfig = {
    architect: { provider: 'force-p', model: 'force-m', reasoningEffort: 'high' },
    worker: { provider: 'force-w', model: 'force-m', reasoningEffort: 'max' },
    explorer: { provider: 'force-e', model: 'force-m', reasoningEffort: 'low' },
    librarian: { provider: 'force-l', model: 'force-m', reasoningEffort: 'none' },
  };
  writeFileSync(sourceFile, JSON.stringify(forceConfig, null, 2));

  const res = importModelsConfig(sourceFile, { force: true }, home);
  assert.equal(res.success, true);
  assert.equal(res.targetPath, targetPath);
  assert.equal(res.count, 4);

  const loaded = JSON.parse(readFileSync(targetPath, 'utf8'));
  assert.equal(loaded.architect.provider, 'force-p');
  assert.equal(loaded.worker.reasoningEffort, 'max');
});

test('importModelsConfig: 源文件不存在时返回拦截原因', (t) => {
  const home = tempHome(t);
  const nonExist = path.join(home, 'not-found.json');
  const res = importModelsConfig(nonExist, {}, home);
  assert.equal(res.success, false);
  assert.equal(res.reason, '源文件不存在: ' + path.resolve(nonExist));
});

test('importModelsConfig: 源文件 JSON 语法损坏时返回失败原因', (t) => {
  const home = tempHome(t);
  const brokenJson = path.join(home, 'broken.json');
  writeFileSync(brokenJson, '{ bad json');
  const res = importModelsConfig(brokenJson, {}, home);
  assert.equal(res.success, false);
  assert.match(res.reason, /^JSON 解析失败: /u);
});

test('importModelsConfig: 源文件顶层非对象时返回格式错误原因', (t) => {
  const home = tempHome(t);
  const arrayJson = path.join(home, 'array.json');
  writeFileSync(arrayJson, JSON.stringify([1, 2, 3]));
  const res = importModelsConfig(arrayJson, {}, home);
  assert.equal(res.success, false);
  assert.equal(res.reason, '配置内容格式错误: 顶层必须为非空对象');
});

test('importModelsConfig: 缺少核心角色时返回缺少角色原因', (t) => {
  const home = tempHome(t);
  const missingRoleJson = path.join(home, 'missing.json');
  writeFileSync(missingRoleJson, JSON.stringify({
    architect: { provider: 'p', model: 'm' },
    worker: { provider: 'p', model: 'm' },
    explorer: { provider: 'p', model: 'm' },
    // 缺少 librarian
  }));
  const res = importModelsConfig(missingRoleJson, {}, home);
  assert.equal(res.success, false);
  assert.equal(res.reason, '缺少必要角色配置: librarian');
});

test('importModelsConfig: 角色缺少必填字段 provider 或 model 时拦截', (t) => {
  const home = tempHome(t);
  const missingFieldJson = path.join(home, 'missing-field.json');
  writeFileSync(missingFieldJson, JSON.stringify({
    architect: { provider: 'p', model: 'm' },
    worker: { provider: '', model: 'm' },
    explorer: { provider: 'p', model: 'm' },
    librarian: { provider: 'p', model: 'm' },
  }));
  const res = importModelsConfig(missingFieldJson, {}, home);
  assert.equal(res.success, false);
  assert.equal(res.reason, '角色 worker 缺少必填字段 provider 或 model');
});

test('importModelsConfig: 角色 reasoningEffort 档位非法时拦截', (t) => {
  const home = tempHome(t);
  const badEffortJson = path.join(home, 'bad-effort.json');
  writeFileSync(badEffortJson, JSON.stringify({
    architect: { provider: 'p', model: 'm' },
    worker: { provider: 'p', model: 'm', reasoningEffort: 'ultra' },
    explorer: { provider: 'p', model: 'm' },
    librarian: { provider: 'p', model: 'm' },
  }));
  const res = importModelsConfig(badEffortJson, {}, home);
  assert.equal(res.success, false);
  assert.equal(res.reason, '角色 worker 的 reasoningEffort "ultra" 不合法，有效档位: ' + VALID_REASONING_EFFORTS.join(', '));
});
