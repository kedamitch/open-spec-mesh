#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureResearchTools, RESEARCH_TOOLS, researchInstallEnv, TOOLS_DIR } from '../lib/installation/tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, env, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 45_000, maxBuffer: 2 * 1024 * 1024, shell: false });
  if (result.error || result.status !== 0) throw new Error(`Research CLI command failed (${result.status ?? result.error?.message ?? 'unknown'}): ${(result.stderr || result.stdout || '').slice(-2500)}`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

export function verifyResearchTools() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-research-tools-'));
  const home = path.join(temp, 'home');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? ''),
    CONTEXT7_API_KEY: 'fixture-not-a-real-key',
    TAVILY_API_KEY: 'fixture-not-a-real-key',
  };
  const cleanEnv = researchInstallEnv(env);
  assert.equal(Object.hasOwn(cleanEnv, 'CONTEXT7_API_KEY'), false);
  assert.equal(Object.hasOwn(cleanEnv, 'TAVILY_API_KEY'), false);
  try {
    const commands = ensureResearchTools(home, { env, reuseGlobal: false, reporter: (line) => process.stdout.write(`${line}\n`) });
    for (const tool of RESEARCH_TOOLS) {
      const manifestPath = path.join(home, TOOLS_DIR, tool.server, 'node_modules', tool.package, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.name, tool.package);
      assert.ok(manifest.version);
      assert.ok(fs.statSync(commands[tool.server]).isFile());
      process.stdout.write(`${tool.server}: ${manifest.name}@${manifest.version}\n`);
    }
    const codegraph = commands.codegraph;
    assert.ok(run(codegraph, ['--version'], cleanEnv, temp).trim());
    assert.match(run(codegraph, ['serve', '--help'], cleanEnv, temp), /--mcp/u);
    const again = ensureResearchTools(home, { env, reporter: () => {} });
    assert.deepEqual(again, commands, 'Installed latest Research CLI paths should be stable on an idempotent second pass');
    process.stdout.write('Research npm CLI smoke passed; no authenticated Context7/Tavily request was made.\n');
    return commands;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyResearchTools(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
