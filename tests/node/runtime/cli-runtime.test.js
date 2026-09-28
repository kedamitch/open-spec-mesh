import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../../../lib/cli/args.js';
import { COMMAND_REGISTRY, implementedCommands, renderHelp, runCommand } from '../../../lib/cli/registry.js';
import { resolveRuntime } from '../../../lib/runtime/location.js';

const repo = path.resolve('.');
const bin = path.join(repo, 'bin/open-spec-mesh.js');
const root = mkdtempSync(path.join(tmpdir(), 'osm cli space '));

test('manifest fixes ESM engine, bin, exact pure-JS/WASM dependencies and lifecycle boundary', () => {
  const manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'open-spec-mesh');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.engines.node, '>=24.21.0');
  assert.equal(manifest.bin['open-spec-mesh'], './bin/open-spec-mesh.js');
  assert.deepEqual(manifest.dependencies, {
    '@modelcontextprotocol/sdk': '1.30.1', 'jszip': '3.10.2', 'lossless-json': '4.3.1', 'smol-toml': '1.4.2', 'sql.js': '1.14.2',
  });
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(manifest.scripts[lifecycle], undefined);
});

test('argument parser supports --key=value, booleans, multi-value and -- separator', () => {
  assert.deepEqual(parseArgs(['docs/02-product', 'Thing', '--root=/tmp/has space', '--directory'], {
    positionals: ['parent', 'title'], options: { root: { kind: 'value' }, directory: { kind: 'boolean' } },
  }), { _: ['docs/02-product', 'Thing'], root: '/tmp/has space', directory: true, parent: 'docs/02-product', title: 'Thing' });
  assert.deepEqual(parseArgs(['change', 'name', '--depends-on', 'C03-01', 'C03-02', '--root', '/tmp/p'], {
    positionals: ['change_id', 'title'], options: { 'depends-on': { kind: 'multiple' }, root: { kind: 'value' } },
  })['depends-on'], ['C03-01', 'C03-02']);
  assert.deepEqual(parseArgs(['--', '--literal'], { positionals: [{ name: 'value' }] }).value, '--literal');
  assert.throws(() => parseArgs(['--unknown'], {}), /unrecognized arguments/);
});

test('fixed registry lists only implemented capabilities and missing routes fail nonzero', async () => {
  const available = implementedCommands(repo);
  assert.ok(available.includes('init-project'));
  assert.ok(available.includes('new-task'));
  assert.ok(available.includes('sdd'));
  assert.ok(!available.includes('install'));
  assert.match(renderHelp(repo, '0.1.0'), /init-project/u);
  assert.match(renderHelp(repo, '0.1.0'), /\n  sdd\n/u);
  assert.doesNotMatch(renderHelp(repo, '0.1.0'), /\n  install\n/u);
  assert.ok(Object.hasOwn(COMMAND_REGISTRY, 'install'));
  let stderr = '';
  assert.equal(await runCommand('install', [], { stderr: { write: (text) => { stderr += text; } } }), 1);
  assert.match(stderr, /not available in this runtime/u);
  assert.equal(await runCommand('not-a-command', [], { stderr: { write: () => {} } }), 2);
});

test('explicit CLI works from a different cwd and with a project path containing spaces', () => {
  const result = spawnSync(process.execPath, [bin, 'init-project', '--root', root], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /osm cli space/u);
  const validate = spawnSync(process.execPath, [bin, 'validate-docs', `--root=${root}`], { cwd: '/', encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(validate.stdout.trim(), 'docs: valid');
  const bad = spawnSync(process.execPath, [bin, 'new-document', 'docs/02-product', 'not a slug', '--root', root], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /English slug/u);
});

test('source and installed skill layouts resolve a fixed runtime, not cwd or npm cache', () => {
  const source = resolveRuntime(import.meta.url);
  assert.equal(source.packageRoot, repo);
  const home = mkdtempSync(path.join(tmpdir(), 'osm installed layout '));
  const runtimeRoot = path.join(home, 'open-spec-mesh/runtime');
  const skillEntry = path.join(home, 'skills/sdd-init/scripts/node_runtime.js');
  mkdirSync(path.dirname(skillEntry), { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  cpSync(path.join(repo, 'package.json'), path.join(runtimeRoot, 'package.json'));
  for (const directory of ['lib/runtime', 'lib/cli', 'lib/documents', 'sdd-init/templates']) cpSync(path.join(repo, directory), path.join(runtimeRoot, directory), { recursive: true });
  cpSync(path.join(repo, 'sdd-init/scripts/node_runtime.js'), skillEntry);
  const installed = resolveRuntime(pathToFileURL(skillEntry));
  assert.equal(installed.packageRoot, runtimeRoot);
  assert.equal(installed.resourceRoot, runtimeRoot);
});

test('local tarball file whitelist excludes Python source, tests and node_modules', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const entries = JSON.parse(result.stdout)[0].files.map((entry) => entry.path);
  assert.ok(entries.includes('bin/open-spec-mesh.js'));
  assert.ok(entries.includes('sdd-init/templates/files/08-quality/Q01-validation.md'));
  assert.ok(!entries.some((name) => name.endsWith('.py') || name.startsWith('tests/') || name.startsWith('node_modules/')));
});
