#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolCases = 'real SDK client lists and calls all four low-level MCP tools over stdio with legacy text envelopes|installed thin wrapper resolves Home/mcp settings and the adjacent runtime without relying on cwd';
const result = spawnSync(process.execPath, [
  '--test', '--test-name-pattern', protocolCases, 'tests/node/systemone/systemone.test.js',
], {
  cwd: ROOT,
  env: { ...process.env, SYSTEMONE_ENABLED: 'true' },
  stdio: 'inherit',
  shell: false,
  timeout: 180_000,
});
if (result.error) { process.stderr.write(`Node MCP SDK smoke failed to start: ${result.error.message}\n`); process.exitCode = 127; }
else if (result.status !== 0) { process.stderr.write(`Node MCP SDK smoke failed: exit=${result.status ?? 1}\n`); process.exitCode = result.status ?? 1; }
else process.stdout.write('Node MCP client/server protocol smoke passed; no GPU inference or authenticated provider call was made.\n');
