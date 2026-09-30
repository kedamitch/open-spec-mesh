import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u);
  for (const lockName of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const lock = JSON.parse(readFileSync(path.join(repo, lockName), 'utf8'));
    assert.equal(lock.version, manifest.version);
    assert.equal(lock.packages[''].version, manifest.version);
  }
  assert.equal(manifest.private, false);
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' });
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.engines.node, '>=22.0.0');
  assert.equal(manifest.bin['open-spec-mesh'], './bin/open-spec-mesh.js');
  assert.equal(manifest.bin.osm, './bin/osm.js');
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

test('fixed registry lists only modules with their registered handlers', async (t) => {
  const available = await implementedCommands(repo);
  assert.ok(available.includes('init-project'));
  assert.ok(available.includes('new-task'));
  assert.equal(available.includes('sdd'), false);
  assert.equal(Object.hasOwn(COMMAND_REGISTRY, 'task-graph'), false);
  assert.ok(available.includes('install'));
  assert.match(await renderHelp(repo, '0.0.1'), /init-project/u);
  assert.doesNotMatch(await renderHelp(repo, '0.0.1'), /\n  sdd\n/u);
  assert.match(await renderHelp(repo, '0.0.1'), /\n  install\n/u);
  assert.ok(Object.hasOwn(COMMAND_REGISTRY, 'install'));
  let stdout = '';
  assert.equal(await runCommand('install', ['--help'], { stdout: { write: (text) => { stdout += text; } } }), 0);
  assert.match(stdout, /Usage: open-spec-mesh install/u);
  assert.equal(await runCommand('not-a-command', [], { stderr: { write: () => {} } }), 2);

  const missingHandlerRoot = mkdtempSync(path.join(tmpdir(), 'osm-missing-command-handler-'));
  t.after(() => rmSync(missingHandlerRoot, { recursive: true, force: true }));
  mkdirSync(path.join(missingHandlerRoot, 'lib/installation'), { recursive: true });
  writeFileSync(path.join(missingHandlerRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(path.join(missingHandlerRoot, 'lib/installation/cli.js'), 'export function unrelatedHandler() {}\n');
  assert.deepEqual(await implementedCommands(missingHandlerRoot), []);
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


test('direct Skill script entrypoints execute handlers rather than silently succeeding', () => {
  for (const command of ['init-project', 'migrate-project', 'new-document', 'validate-docs', 'new-change', 'ensure-design', 'new-task', 'new-research', 'new-adr', 'new-release']) {
    const relative = command === 'new-release' ? 'sdd-release/scripts/new_release.js' : COMMAND_REGISTRY[command][0];
    const result = spawnSync(process.execPath, [path.join(repo, relative), '--help'], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/u, command + ' must really run its handler');
  }
  const result = spawnSync(process.execPath, [path.join(repo, COMMAND_REGISTRY['validate-docs'][0]), '--root', root], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'docs: valid');
});


test('runtime entry guard requires the caller URL and never infers another module is main', async () => {
  const { isMain } = await import('../../../sdd-init/scripts/node_runtime.js');
  assert.throws(() => isMain(), /caller import.meta.url/u);
  assert.equal(isMain(new URL('../../../sdd-init/scripts/node_runtime.js', import.meta.url).href), false);
});
