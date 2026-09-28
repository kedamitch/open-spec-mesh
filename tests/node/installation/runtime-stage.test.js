import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RUNTIME_INTERNALS, buildRuntimeStage, compareLockBytes } from '../../../lib/installation/runtime-stage.js';
import { REPO_ROOT } from './helpers.js';

test('published file selection contains install routes and canonical resources, but no dev or Python assets', () => {
  const { manifest } = compareLockBytes(REPO_ROOT);
  const files = RUNTIME_INTERNALS.packageFiles(REPO_ROOT, manifest);
  for (const required of [
    'bin/open-spec-mesh.js', 'scripts/install.js', 'scripts/host_adapter.js',
    'scripts/install_toml.js', 'scripts/install_migrations.js', 'scripts/install-legacy.json',
    'lib/installation/cli.js', 'lib/installation/installer.js', 'mcp/laya_http_mcp.js',
    'npm-shrinkwrap.json', 'docs/index.md', 'sdd-do/SKILL.md', 'typesafe-laya/LICENSE',
  ]) assert.equal(files.includes(required), true, `missing ${required}`);
  assert.equal(files.some((file) => file === 'package-lock.json' || file.endsWith('/package-lock.json')), false);
  assert.equal(files.some((file) => file.endsWith('/C03-task-graph.json')), false);
  assert.equal(files.some((file) => file.startsWith('tests/')), false);
  assert.equal(files.some((file) => /\.(?:py|pyc|pyo)$/iu.test(file)), false);
  assert.equal(files.some((file) => file.split('/').includes('node_modules')), false);
  assert.equal(files.some((file) => file === '.env' || file.endsWith('/.env')), false);
});

test('published lock is byte-identical to the root development lock', () => {
  const a = compareLockBytes(REPO_ROOT).shrinkwrap;
  assert.equal(a.equals((awaitlessRead(REPO_ROOT, 'package-lock.json'))), true);
});

function awaitlessRead(root, relative) {
  return readFileSync(path.join(root, relative));
}

test('lock mismatch fails closed before any install stage is created', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'osm-lock-mismatch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = { name: 'open-spec-mesh', version: '1.0.0', dependencies: { sample: '1.0.0' } };
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { '': { dependencies: manifest.dependencies } } };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  writeFileSync(path.join(root, 'npm-shrinkwrap.json'), JSON.stringify({ ...lock, version: '1.0.1' }));
  assert.throws(() => compareLockBytes(root), /differ/);
  assert.deepEqual(readdirSync(root).sort(), ['npm-shrinkwrap.json', 'package-lock.json', 'package.json']);
});

test('runtime dependency failure is isolated, key-clean, and does not leak npm output', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'osm-runtime-failure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const capture = path.join(root, 'npm-call.json');
  const fakeNpm = path.join(root, 'npm');
  writeFileSync(fakeNpm, `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(process.env.TEST_NPM_CAPTURE, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), keys: ['TYPESAFE_API_KEY','LAYA_API_KEY','LAYA_BASE_URL','CONTEXT7_API_KEY','TAVILY_API_KEY'].map((key) => [key, Object.hasOwn(process.env, key)]) }));\nconsole.log('private npm diagnostic must not be relayed');\nprocess.exit(17);\n`);
  chmodSync(fakeNpm, 0o755);
  const destination = path.join(root, 'stage');
  const reporter = [];
  await assert.rejects(buildRuntimeStage(REPO_ROOT, destination, {
    host: 'codex', npmPath: fakeNpm, reporter: (line) => reporter.push(line),
    env: {
      PATH: process.env.PATH ?? '', TEST_NPM_CAPTURE: capture,
      TYPESAFE_API_KEY: 'test-only-typesafe-sentinel', LAYA_API_KEY: 'test-only-laya-sentinel',
      LAYA_BASE_URL: 'https://unit.invalid', CONTEXT7_API_KEY: 'test-only-context-sentinel',
      TAVILY_API_KEY: 'test-only-tavily-sentinel',
    },
  }), (error) => {
    assert.match(error.message, /npm exit 17/);
    assert.equal(error.message.includes('private npm diagnostic'), false);
    return true;
  });
  const call = JSON.parse(readFileSync(capture, 'utf8'));
  assert.deepEqual(call.args, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(call.cwd, destination);
  assert.equal(call.keys.every(([, present]) => present === false), true);
  assert.equal(reporter.some((line) => line.includes('npm ci --omit=dev --ignore-scripts')), true);
});

test('missing required package routes fail before npm is invoked or a destination is published', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'osm-missing-route-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = {
    name: 'open-spec-mesh', version: '0.1.0', private: true, type: 'module',
    engines: { node: '>=24.21.0' }, files: ['package.json', 'npm-shrinkwrap.json'], dependencies: {},
  };
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { '': { dependencies: {} } } };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(path.join(root, 'npm-shrinkwrap.json'), JSON.stringify(lock));
  const destination = path.join(root, 'runtime');
  await assert.rejects(buildRuntimeStage(root, destination, { npmPath: '/nonexistent/npm' }), /Package files omit required runtime asset/);
  assert.equal(existsSync(destination), false);
});
