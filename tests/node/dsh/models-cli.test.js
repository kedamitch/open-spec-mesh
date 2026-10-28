import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runModelsCommand } from '../../../lib/cli/models.js';
import { getModelsConfigPath } from '../../../lib/installation/models-config.js';

function createMemoryStreams() {
  let stdoutData = '';
  let stderrData = '';
  return {
    streams: {
      stdout: {
        write(chunk) {
          stdoutData += chunk;
        },
      },
      stderr: {
        write(chunk) {
          stderrData += chunk;
        },
      },
    },
    getStdout: () => stdoutData,
    getStderr: () => stderrData,
  };
}

function tempHome(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'osm-models-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('osm models doctor: 文件不存在时输出默认提示并以 0 退出', (t) => {
  const home = tempHome(t);
  const { streams, getStdout } = createMemoryStreams();
  const code = runModelsCommand(['doctor'], streams, home);
  assert.equal(code, 0);
  const out = getStdout();
  assert.match(out, /Open Spec Mesh 模型配置诊断报告/u);
  assert.match(out, /未检测到 ~\/.*osm-models\.json/u);
  assert.match(out, /architect.*OK/u);
  assert.match(out, /worker.*OK/u);
});

test('osm models check: 作为 doctor 别名行为一致', (t) => {
  const home = tempHome(t);
  const { streams, getStdout } = createMemoryStreams();
  const code = runModelsCommand(['check'], streams, home);
  assert.equal(code, 0);
  assert.match(getStdout(), /模型配置诊断报告/u);
});

test('osm models doctor: 完整合规配置输出 OK 且返回 0', (t) => {
  const home = tempHome(t);
  const cfg = {
    architect: { provider: 'p1', model: 'm1', reasoningEffort: 'xhigh' },
    worker: { provider: 'p2', model: 'm2', reasoningEffort: 'max' },
    explorer: { provider: 'p3', model: 'm3', reasoningEffort: 'low' },
    librarian: { provider: 'p4', model: 'm4', reasoningEffort: 'default' },
  };
  writeFileSync(getModelsConfigPath(home), JSON.stringify(cfg));
  const { streams, getStdout } = createMemoryStreams();
  const code = runModelsCommand(['doctor'], streams, home);
  assert.equal(code, 0);
  const out = getStdout();
  assert.match(out, /所有 4 个核心角色模型配置合规/u);
  assert.doesNotMatch(out, /❌/u);
});

test('osm models doctor: 缺少 provider/model 或非法 effort 标红/报错并输出修复建议，返回 1', (t) => {
  const home = tempHome(t);
  const badCfg = {
    worker: { provider: '', model: 'm2', reasoningEffort: 'super' },
    explorer: { provider: 'p3' },
  };
  writeFileSync(getModelsConfigPath(home), JSON.stringify(badCfg));
  const { streams, getStdout } = createMemoryStreams();
  const code = runModelsCommand(['doctor'], streams, home);
  assert.equal(code, 1);
  const out = getStdout();
  assert.match(out, /❌ 发现 .* 个配置问题/u);
  assert.match(out, /worker: 缺少必填字段 provider/u);
  assert.match(out, /worker: reasoningEffort 档位 "super" 非法/u);
  assert.match(out, /explorer: 缺少必填字段 model/u);
  assert.match(out, /💡 一键修复建议:/u);
  assert.match(out, /osm models set worker/u);
});

test('osm models doctor: JSON 解析失败提示 reset 并返回 1', (t) => {
  const home = tempHome(t);
  writeFileSync(getModelsConfigPath(home), '{ bad json');
  const { streams, getStdout } = createMemoryStreams();
  const code = runModelsCommand(['doctor'], streams, home);
  assert.equal(code, 1);
  const out = getStdout();
  assert.match(out, /解析失败/u);
  assert.match(out, /osm models reset/u);
});

test('未知子命令帮助提示包含 doctor 与 check 及 export 与 import', () => {
  const { streams, getStderr } = createMemoryStreams();
  const code = runModelsCommand(['unknown_cmd'], streams);
  assert.equal(code, 1);
  assert.match(getStderr(), /doctor\|check/u);
  assert.match(getStderr(), /export \[filepath\]/u);
  assert.match(getStderr(), /import <filepath> \[--force\]/u);
});

test('osm models export: 缺省路径导出到当前目录 osm-models-backup.json 且退出码为 0', (t) => {
  const home = tempHome(t);
  const defaultFile = path.resolve(process.cwd(), 'osm-models-backup.json');
  t.after(() => rmSync(defaultFile, { force: true }));

  const { streams, getStdout } = createMemoryStreams();
  const code = runModelsCommand(['export'], streams, home);
  assert.equal(code, 0);
  assert.match(getStdout(), /已成功导出模型配置至: .*osm-models-backup\.json/u);
});

test('osm models export: 指定自定义路径导出成功且退出码为 0', (t) => {
  const home = tempHome(t);
  const customFile = path.join(home, 'exports', 'backup.json');

  const { streams, getStdout } = createMemoryStreams();
  const code = runModelsCommand(['export', customFile], streams, home);
  assert.equal(code, 0);
  assert.match(getStdout(), /已成功导出模型配置至: .*backup\.json/u);
});

test('osm models import: 缺少 filepath 参数输出用法错误并返回 1', (t) => {
  const home = tempHome(t);
  const { streams, getStderr } = createMemoryStreams();
  const code = runModelsCommand(['import'], streams, home);
  assert.equal(code, 1);
  assert.match(getStderr(), /错误: 必须指定导入文件的路径/u);
  assert.match(getStderr(), /用法: osm models import <filepath> \[--force\]/u);
});

test('osm models import: 源文件不存在或格式损坏时输出错误并返回 1', (t) => {
  const home = tempHome(t);
  const { streams: s1, getStderr: getStderr1 } = createMemoryStreams();
  const code1 = runModelsCommand(['import', '/non/existent/path/models.json'], s1, home);
  assert.equal(code1, 1);
  assert.match(getStderr1(), /源文件不存在/u);

  const brokenFile = path.join(home, 'broken.json');
  writeFileSync(brokenFile, '{ broken');
  const { streams: s2, getStderr: getStderr2 } = createMemoryStreams();
  const code2 = runModelsCommand(['import', brokenFile], s2, home);
  assert.equal(code2, 1);
  assert.match(getStderr2(), /JSON 解析失败/u);
});

test('osm models import: 目标已存在且未提供 --force 时拦截并返回 1，原文件未修改', (t) => {
  const home = tempHome(t);
  const targetPath = getModelsConfigPath(home);
  const originalCfg = {
    architect: { provider: 'orig_p', model: 'orig_m', reasoningEffort: 'low' },
  };
  writeFileSync(targetPath, JSON.stringify(originalCfg));

  const newBackup = path.join(home, 'new.json');
  const validCfg = {
    architect: { provider: 'p1', model: 'm1', reasoningEffort: 'xhigh' },
    worker: { provider: 'p2', model: 'm2', reasoningEffort: 'max' },
    explorer: { provider: 'p3', model: 'm3', reasoningEffort: 'low' },
    librarian: { provider: 'p4', model: 'm4', reasoningEffort: 'default' },
  };
  writeFileSync(newBackup, JSON.stringify(validCfg));

  const { streams, getStderr } = createMemoryStreams();
  const code = runModelsCommand(['import', newBackup], streams, home);
  assert.equal(code, 1);
  assert.match(getStderr(), /目标模型配置文件已存在/u);
  assert.match(getStderr(), /请添加 --force 参数/u);

  // 验证原文件未被覆盖
  assert.match(readFileSync(targetPath, 'utf8'), /orig_p/u);
});

test('osm models import: 目标不存在或带 --force 时成功还原并返回 0', (t) => {
  const home = tempHome(t);
  const backupFile = path.join(home, 'backup.json');
  const validCfg = {
    architect: { provider: 'p1', model: 'm1', reasoningEffort: 'xhigh' },
    worker: { provider: 'p2', model: 'm2', reasoningEffort: 'max' },
    explorer: { provider: 'p3', model: 'm3', reasoningEffort: 'low' },
    librarian: { provider: 'p4', model: 'm4', reasoningEffort: 'default' },
  };
  writeFileSync(backupFile, JSON.stringify(validCfg));

  // 1. 目标不存在直接还原成功
  const { streams: s1, getStdout: getStdout1 } = createMemoryStreams();
  const code1 = runModelsCommand(['import', backupFile], s1, home);
  assert.equal(code1, 0);
  assert.match(getStdout1(), /成功从 .* 还原模型配置至:/u);

  // 2. 目标已存在但传入 --force 强制覆盖成功
  const { streams: s2, getStdout: getStdout2 } = createMemoryStreams();
  const code2 = runModelsCommand(['import', backupFile, '--force'], s2, home);
  assert.equal(code2, 0);
  assert.match(getStdout2(), /成功从 .* 还原模型配置至:/u);
});
