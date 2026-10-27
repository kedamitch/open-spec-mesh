import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { INSTALL_INTERNALS, installHost } from '../../../lib/installation/installer.js';
import { inspectHost, inspectMarkdown, runInspectHost } from '../../../lib/installation/inspect.js';
import { RUNTIME_INTERNALS } from '../../../lib/installation/runtime-stage.js';
import { REPO_ROOT, tempDirectory } from '../installation/helpers.js';

const packageFiles = RUNTIME_INTERNALS.packageFiles(REPO_ROOT, JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')));

// /var 在 macOS 上是指向 /private/var 的符号链接，安装器会拒绝符号链接路径，因此先取 realpath。
function sandbox(t) {
  const root = realpathSync(tempDirectory(t));
  const home = path.join(root, 'dsh-home');
  mkdirSync(home, { recursive: true });
  return { root, home };
}
function stageDir(root, name) {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}
function buildDsh({ home, hostStage }) {
  return INSTALL_INTERNALS.buildHostStage({
    source: REPO_ROOT, home, host: 'dsh', hostStage, runtimeRoot: REPO_ROOT, runtimeFiles: packageFiles,
    toolCommands: null, layaManaged: true, effectiveLaya: false, withLaya: false, includeProjectDocs: false,
    codexText: readFileSync(path.join(REPO_ROOT, 'config.toml'), 'utf8'), codexConfigExisted: false,
    previousLaya: undefined, previousHost: new Set(),
  });
}

test('dsh 安装只落 AGENTS.md 与 sdd-* 技能，不写 agents/*.md', async (t) => {
  const { root, home } = sandbox(t);
  const result = await buildDsh({ home, hostStage: stageDir(root, 'stage') });
  assert.equal(result.operations.some((item) => item.relative.startsWith('agents/')), false);
  assert.equal(result.operations.some((item) => item.relative === 'open-spec-mesh/agents/index.md'), true);
  assert.equal(result.operations.some((item) => item.relative === 'AGENTS.md'), true);
  assert.equal(result.operations.some((item) => item.relative.startsWith('skills/sdd-')), true);
  assert.equal(result.operations.some((item) => item.relative.startsWith('mcp/laya-')), false);
  const rules = readFileSync(path.join(root, 'stage', 'AGENTS.md'), 'utf8');
  assert.ok(rules.includes('<!-- open-spec-mesh: BEGIN -->'));
  assert.ok(rules.includes('<!-- open-spec-mesh: END -->'));
  assert.equal(existsSync(path.join(root, 'stage', 'agents', 'main.md')), false);
});

test('dsh 的 AGENTS.md 受管章节重复执行后字节不变且保留用户文本', async (t) => {
  const { root, home } = sandbox(t);
  writeFileSync(path.join(home, 'AGENTS.md'), '# 用户自有规则\n\n- 保留这一行\n\n<!-- open-spec-mesh: BEGIN -->\n\nstale managed block\n\n<!-- open-spec-mesh: END -->\n');
  await buildDsh({ home, hostStage: stageDir(root, 'stage1') });
  const first = readFileSync(path.join(root, 'stage1', 'AGENTS.md'), 'utf8');
  assert.equal((first.match(/<!-- open-spec-mesh: BEGIN -->/gu) ?? []).length, 1);
  assert.equal((first.match(/<!-- open-spec-mesh: END -->/gu) ?? []).length, 1);
  assert.ok(first.includes('- 保留这一行'));
  assert.equal(first.includes('stale managed block'), false);

  writeFileSync(path.join(home, 'AGENTS.md'), first);
  await buildDsh({ home, hostStage: stageDir(root, 'stage2') });
  assert.equal(readFileSync(path.join(root, 'stage2', 'AGENTS.md'), 'utf8'), first);
});

test('--with-laya 与 dsh 组合在写入前直接报错', async (t) => {
  const { root, home } = sandbox(t);
  const target = path.join(root, 'untouched-home');
  await assert.rejects(
    installHost({ source: REPO_ROOT, host: 'dsh', home: target, withLaya: true, nodeVersion: '22.0.0' }),
    /--with-laya is not supported for dsh/u,
  );
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(home), true);
});

test('dsh dry-run 说明 research tools 走 preset MCP 并给出下一步命令', async (t) => {
  const { root } = sandbox(t);
  const report = [];
  await installHost({
    source: REPO_ROOT, host: 'dsh', home: path.join(root, 'dry-home'), dryRun: true, skipTools: true,
    nodeVersion: '22.0.0', env: { PATH: process.env.PATH ?? '' }, reporter: (line) => report.push(line),
  });
  const text = report.join('\n');
  assert.match(text, /reads research tools from the preset mcp config/u);
  assert.match(text, /dsh plugin --profile <profile> add open-spec-mesh/u);
  assert.equal(existsSync(path.join(root, 'dry-home')), false);
});

test('inspect-host 用 AGENTS.md 受管章节与 sdd-* 技能判定 dsh 安装', async (t) => {
  const { home } = sandbox(t);
  const before = inspectHost({ host: 'dsh', home, source: REPO_ROOT });
  assert.equal(before.roles.length, 5);
  assert.equal(before.roles.every((role) => role.status === 'not_applicable' && role.file === null), true);
  assert.equal(before.dsh.agents_md_managed_section, false);
  assert.deepEqual(before.dsh.sdd_skills, []);

  writeFileSync(path.join(home, 'AGENTS.md'), '<!-- open-spec-mesh: BEGIN -->\n\nx\n\n<!-- open-spec-mesh: END -->\n');
  mkdirSync(path.join(home, 'skills', 'sdd-do'), { recursive: true });
  const after = inspectHost({ host: 'dsh', home, source: REPO_ROOT });
  assert.equal(after.dsh.agents_md_status, 'read');
  assert.equal(after.dsh.agents_md_managed_section, true);
  assert.deepEqual(after.dsh.sdd_skills, ['sdd-do']);
  const markdown = inspectMarkdown(after);
  assert.match(markdown, /DSH 安装证据/u);
  assert.match(markdown, /sdd-do/u);

  let usage = '';
  await runInspectHost(['--help'], { stdout: { write: (value) => { usage += value; } } });
  assert.match(usage, /--host codex\|opencode\|claude\|dsh/u);
});
