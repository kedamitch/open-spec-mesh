import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('未知子命令帮助提示包含 doctor 与 check', () => {
  const { streams, getStderr } = createMemoryStreams();
  const code = runModelsCommand(['unknown_cmd'], streams);
  assert.equal(code, 1);
  assert.match(getStderr(), /doctor\|check/u);
});
