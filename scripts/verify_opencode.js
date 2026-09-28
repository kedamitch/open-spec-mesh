#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHost } from '../lib/installation/installer.js';
import { hostCommand } from '../lib/workflow/leaf.js';
import { resolveExecutable } from '../lib/installation/tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, { cwd, env = process.env, timeout = 60_000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, shell: false });
  if (result.error || result.status !== 0) throw new Error(`OpenCode smoke failed (${result.status ?? result.error?.message ?? 'unknown'}): ${(result.stderr || result.stdout || '').slice(-4000)}`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

export async function verifyOpenCode() {
  const binary = resolveExecutable('opencode');
  if (!binary) throw new Error('OpenCode CLI missing; runtime smoke did not run');
  process.stdout.write(`OpenCode: ${run(binary, ['--version'], { cwd: ROOT }).trim()}\n`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-opencode-smoke-'));
  try {
    const home = path.join(temp, 'config'); const project = path.join(temp, 'project'); const userHome = path.join(temp, 'user');
    fs.mkdirSync(project); fs.mkdirSync(userHome);
    run('git', ['init', '-q', project], { cwd: temp });
    await installHost({ source: ROOT, host: 'opencode', home, skipTools: true, reporter: () => {} });
    const env = { ...process.env, HOME: userHome, XDG_CONFIG_HOME: path.join(temp, 'xdg'), OPENCODE_CONFIG_DIR: home, OPENCODE_CONFIG: path.join(home, 'open-spec-mesh.opencode.json'), OPENCODE_DISABLE_AUTOUPDATE: '1' };
    const configOutput = run(binary, ['debug', 'config'], { cwd: project, env });
    const sources = JSON.parse(configOutput);
    assert.ok(Array.isArray(sources), 'OpenCode debug config returned an unexpected shape');
    const sourceText = JSON.stringify(sources);
    assert.ok(sourceText.includes(path.join(home, 'open-spec-mesh.opencode.json')) || sourceText.includes('open-spec-mesh.opencode.json'), 'OpenCode did not load the managed overlay');
    const overlay = JSON.parse(fs.readFileSync(path.join(home, 'open-spec-mesh.opencode.json'), 'utf8'));
    assert.equal(overlay.default_agent, 'main');
    assert.equal(Object.hasOwn(overlay, 'model'), false, 'Overlay must not select the user model');
    const expectedRoles = new Set(['main', 'architect', 'worker', 'reviewer', 'explorer', 'librarian']);
    assert.deepEqual(new Set(Object.keys(overlay.agents ?? {})), expectedRoles);
    for (const [role, definition] of Object.entries(overlay.agents)) assert.equal(Object.hasOwn(definition, 'model'), false, `Managed overlay must not set ${role} model`);
    const parsedDocument = sources.find((item) => item?.type === 'document' && String(item.path ?? '').endsWith('open-spec-mesh.opencode.json'));
    assert.ok(parsedDocument, 'OpenCode native config source document missing');
    const parsedAgents = parsedDocument.info?.agents ?? {};
    assert.deepEqual(new Set(Object.keys(parsedAgents)), expectedRoles);
    assert.equal(parsedAgents.main.mode, 'primary');
    for (const role of expectedRoles) if (role !== 'main') assert.equal(parsedAgents[role].mode, 'subagent');
    for (const [role, definition] of Object.entries(parsedAgents)) assert.equal(Object.hasOwn(definition, 'model'), false, `Parsed config unexpectedly selected ${role} model`);
    const help = run(binary, ['run', '--help'], { cwd: project, env });
    const built = hostCommand('opencode', binary, 'worker', project, 'ses_123456', home, env);
    for (const flag of ['--agent', '--format', '--session']) { assert.ok(help.includes(flag), `Native OpenCode help missing ${flag}`); assert.ok(built.argv.includes(flag), `OpenCode launcher missing ${flag}`); }
    if (built.argv.some((arg) => ['--dir', '--directory'].includes(arg))) assert.ok(['--dir', '--directory'].some((flag) => help.includes(flag)), 'Launcher uses unsupported directory flag');
    assert.equal(built.env.OPENCODE_CONFIG_DIR, home);
    assert.doesNotMatch(built.argv.join(' ').toLowerCase(), /worktree/u);
    process.stdout.write('OpenCode native config/agent/launcher smoke passed without a model call.\n');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyOpenCode().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
