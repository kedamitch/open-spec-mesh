#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { runChecks } from '../lib/validation/runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function testFiles(directory) {
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) found.push(path.relative(ROOT, full));
    }
  };
  visit(directory);
  return found;
}

export function parseProfile(argv) {
  let profile = 'core';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      profile = argv[++index];
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['core', 'full'].includes(profile)) throw new Error(`Unknown validation profile: ${profile}`);
  return { profile };
}

export function checksFor(profile, root = ROOT, { mermaidOutput = path.join(os.tmpdir(), `osm-mermaid-${process.pid}`) } = {}) {
  const node = process.execPath;
  const files = testFiles(path.join(root, 'tests/node'));
  if (files.length === 0) throw new Error('No Node test files found under tests/node');
  const checks = [
    { name: 'Node unit/integration regression suite', command: node, args: ['--test', ...files] },
    { name: 'Agent routing and policy regressions', command: node, args: ['--test', 'agents/test_validate_agents.js'] },
    { name: 'Agent model/effort/config/routing validation', command: node, args: ['agents/validate_agents.js'] },
    { name: 'Discovered Node regression inventory (not a frozen count)', command: node, args: ['scripts/verify_coverage.js'] },
    { name: 'Runtime syntax, package resources, source and ignore safety', command: node, args: ['scripts/check_runtime.js'] },
    { name: 'Documentation structure and link validation', command: node, args: ['sdd-init/scripts/validate_docs.js', '--root', '.'] },
    { name: 'Installer shell syntax', command: 'bash', args: ['-n', 'install.sh'] },
    { name: 'Installer no-write dry run', command: 'bash', args: ['install.sh', '--dry-run'] },
    { name: 'Published tarball isolated Node consumer smoke', command: node, args: ['scripts/verify_tarball.js'] },
  ];
  if (profile === 'full') {
    checks.push(
      { name: 'Mermaid diagrams with real renderer', command: node, args: ['scripts/render_mermaid.js', '--output', mermaidOutput] },
      { name: 'Docker application fixture smoke', command: node, args: ['scripts/verify_docker.js'] },
      { name: 'Codex native Multi-Agent V2 runtime smoke', command: node, args: ['scripts/verify_codex.js'] },
      { name: 'OpenCode native config, agents and MCP smoke', command: node, args: ['scripts/verify_opencode.js'] },
      { name: 'Claude Code native agent and MCP smoke', command: node, args: ['scripts/verify_claude.js'] },
      { name: 'Research npm package/CLI smoke without authenticated requests', command: node, args: ['scripts/verify_research_tools.js'] },
      { name: 'Node MCP SDK protocol client smoke', command: node, args: ['scripts/verify_laya.js'] },
    );
  }
  return checks;
}

function usage() {
  return 'Usage: node scripts/sdd_validate.js [--profile core|full]\n\n'
    + 'core checks Node regressions, zero first-party Python sources, documents and isolated consumption. full additionally requires real host CLIs, Docker, Mermaid, Research packages and Node MCP; external inference services are operator-provided and are not tested by this profile.\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const parsed = parseProfile(process.argv.slice(2));
    if (parsed.help) process.stdout.write(usage());
    else {
      const temporary = parsed.profile === 'full' ? mkdtempSync(path.join(os.tmpdir(), 'osm-full-validation-')) : null;
      try {
        process.exitCode = runChecks(checksFor(parsed.profile, ROOT, { mermaidOutput: temporary ? path.join(temporary, 'rendered') : undefined }), { cwd: ROOT });
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}`);
    process.exitCode = 2;
  }
}
