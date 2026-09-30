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
  if (result.error || result.status !== 0) throw new Error(`Claude Code smoke failed (${result.status ?? result.error?.message ?? 'unknown'}): ${(result.stderr || result.stdout || '').slice(-4000)}`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

export async function verifyClaude() {
  const binary = resolveExecutable('claude');
  if (!binary) throw new Error('Claude Code CLI missing; runtime smoke did not run');
  process.stdout.write(`Claude Code: ${run(binary, ['--version'], { cwd: ROOT }).trim()}\n`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-claude-smoke-'));
  try {
    const home = path.join(temp, 'claude'); const project = path.join(temp, 'project'); const userHome = path.join(temp, 'user');
    fs.mkdirSync(project); fs.mkdirSync(userHome);
    run('git', ['init', '-q', project], { cwd: temp });
    await installHost({ source: ROOT, host: 'claude', home, skipTools: true, reporter: () => {} });
    const env = { ...process.env, HOME: userHome, CLAUDE_CONFIG_DIR: home, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
    const help = run(binary, ['--help'], { cwd: project, env });
    for (const flag of ['--agent', '--resume', '--mcp-config', '--output-format', '--verbose']) assert.ok(help.includes(flag), `Claude Code native help missing ${flag}`);
    run(binary, ['plugin', 'validate', path.join(home, 'agents')], { cwd: project, env });
    const main = fs.readFileSync(path.join(home, 'agents/main.md'), 'utf8');
    const architect = fs.readFileSync(path.join(home, 'agents/architect.md'), 'utf8');
    const worker = fs.readFileSync(path.join(home, 'agents/worker.md'), 'utf8');
    assert.ok(main.includes('Agent(architect, worker, reviewer, explorer, librarian)'), 'Main delegation allowlist missing');
    assert.ok(architect.includes('Agent(explorer, librarian)'), 'Architect local delegation allowlist missing');
    assert.doesNotMatch(worker, /Agent\(/u, 'Worker must not receive the Agent tool');
    assert.ok(worker.includes('model: inherit') && !worker.includes('gpt-6-'), 'Worker host model must be inherited');
    const mcp = JSON.parse(fs.readFileSync(path.join(home, 'open-spec-mesh.mcp.json'), 'utf8'));
    for (const name of ['codegraph', 'context7', 'tavily']) assert.ok(Object.hasOwn(mcp.mcpServers ?? {}, name), `MCP overlay missing ${name}`);
    assert.ok(fs.readFileSync(path.join(home, 'agents/worker.md'), 'utf8').includes('宏观 Task'));
    process.stdout.write('Claude native agent/launcher smoke passed without a model call.\n');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyClaude().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
