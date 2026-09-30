#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHost } from '../lib/installation/installer.js';
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
    const parsed = JSON.parse(configOutput);
    assert.ok(parsed && !Array.isArray(parsed) && typeof parsed === 'object', 'OpenCode V1 debug config returned an unexpected shape');
    const overlay = JSON.parse(fs.readFileSync(path.join(home, 'open-spec-mesh.opencode.json'), 'utf8'));
    assert.equal(parsed.default_agent, 'main', 'OpenCode did not load the managed primary agent');
    assert.equal(Object.hasOwn(overlay, 'model'), false, 'Overlay must not select the user model');
    assert.equal(Object.hasOwn(overlay, 'agents'), false, 'Do not emit V2-only agents input');
    const expectedRoles = new Set(['main', 'architect', 'worker', 'reviewer', 'explorer', 'librarian']);
    assert.deepEqual(new Set(Object.keys(overlay.agent ?? {})), expectedRoles);
    assert.deepEqual(new Set(Object.keys(parsed.agent ?? {})), expectedRoles);
    for (const [role, definition] of Object.entries(overlay.agent)) {
      assert.equal(Object.hasOwn(definition, 'model'), false, 'Managed overlay must inherit role model');
      const native = parsed.agent[role];
      assert.equal(Object.hasOwn(native, 'model'), false, 'Parsed config must inherit role model');
      assert.equal(native.mode, role === 'main' ? 'primary' : 'subagent');
      assert.equal(native.prompt, definition.prompt, 'Native prompt must match managed source');
      assert.deepEqual(native.permission, definition.permission, 'Native least-privilege permissions must survive parsing');
    }
    for (const name of ['codegraph', 'context7', 'tavily']) {
      assert.equal(parsed.mcp[name].type, 'local');
      assert.deepEqual(parsed.mcp[name].command, overlay.mcp[name].command, 'OpenCode must load each managed MCP command');
    }
    const help = run(binary, ['run', '--help'], { cwd: project, env });
    assert.ok(fs.readFileSync(path.join(home, 'agents/worker.md'), 'utf8').includes('宏观 Task'));
    process.stdout.write('OpenCode native config/agent/MCP smoke passed without a model call.\n');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyOpenCode().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
