#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RETAINED_PYTHON = new Set([
  'integrations/laya-gpu/contracts.py',
  'mcp/laya_batch_server.py', 'mcp/laya_contracts.py', 'mcp/laya_http_mcp.py', 'mcp/laya_runtime.py',
  'tests/test_laya_server.py', 'tests/fixtures/docker-app/app.py',
]);
const WALK_SKIP = new Set(['.git', 'node_modules', '.venv', '.validation-output']);

export function walk(root, predicate = () => true) {
  const out = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (WALK_SKIP.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && predicate(absolute)) out.push(absolute);
    }
  };
  visit(root);
  return out;
}

function rel(file) { return path.relative(ROOT, file).split(path.sep).join('/'); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(-5000)}`);
  return result.stdout ?? '';
}

export function verifyRetiredPythonSources(root = ROOT) {
  const files = walk(root, (file) => file.endsWith('.py')).map((file) => path.relative(root, file).split(path.sep).join('/'));
  const forbidden = files.filter((file) => (
    /^(scripts|agents)\//.test(file)
    || /^sdd-[^/]+\/scripts\//.test(file)
    || (/^tests\/test_[^/]+\.py$/.test(file) && !RETAINED_PYTHON.has(file))
  ));
  const unexpected = files.filter((file) => !RETAINED_PYTHON.has(file));
  assert.deepEqual(forbidden, [], `First-party Python platform source remains: ${forbidden.join(', ')}`);
  assert.deepEqual(unexpected, [], `Unclassified Python source remains: ${unexpected.join(', ')}`);
  for (const keep of RETAINED_PYTHON) assert.ok(fs.existsSync(path.join(root, keep)), `Required GPU/fixture exception missing: ${keep}`);
  return { files, retained: [...RETAINED_PYTHON].sort() };
}

export function verifyRootIgnore(root = ROOT) {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(ignore.split(/\r?\n/u).includes('/node_modules/'), 'Root node_modules must have an anchored ignore rule');
  assert.doesNotMatch(ignore, /(?:^|\n)\*\*\/node_modules\//u, 'Nested node_modules must not be broadly ignored');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-ignore-audit-'));
  try {
    const repo = path.join(temp, 'repo');
    const home = path.join(temp, 'home', '.codex', 'open-spec-mesh');
    fs.mkdirSync(path.join(repo, 'nested', 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.copyFileSync(path.join(root, '.gitignore'), path.join(repo, '.gitignore'));
    fs.writeFileSync(path.join(repo, 'node_modules', 'user-sentinel.txt'), 'keep-root-dependency-bytes\n');
    fs.writeFileSync(path.join(repo, 'nested', 'node_modules', 'sentinel.txt'), 'nested remains visible\n');
    fs.writeFileSync(path.join(repo, 'package-lock.json'), fs.readFileSync(path.join(root, 'package-lock.json')));
    fs.writeFileSync(path.join(repo, 'npm-shrinkwrap.json'), fs.readFileSync(path.join(root, 'npm-shrinkwrap.json')));
    const homeSentinel = path.join(home, 'user-owned-sentinel.txt');
    fs.writeFileSync(homeSentinel, 'home bytes must remain untouched\n');
    const before = fs.readFileSync(homeSentinel);
    run('git', ['init', '-q', repo]);
    const ignored = spawnSync('git', ['-C', repo, 'check-ignore', 'node_modules/user-sentinel.txt'], { encoding: 'utf8' });
    assert.equal(ignored.status, 0, 'Root dependency tree must be ignored');
    const nested = spawnSync('git', ['-C', repo, 'check-ignore', 'nested/node_modules/sentinel.txt'], { encoding: 'utf8' });
    assert.notEqual(nested.status, 0, 'Nested dependency directory must not be ignored by the root rule');
    run('git', ['-C', repo, 'add', 'package-lock.json', 'npm-shrinkwrap.json']);
    const tracked = run('git', ['-C', repo, 'ls-files', '--error-unmatch', 'package-lock.json', 'npm-shrinkwrap.json']);
    assert.match(tracked, /package-lock\.json/u);
    assert.match(tracked, /npm-shrinkwrap\.json/u);
    assert.equal(fs.readFileSync(homeSentinel).compare(before), 0, 'User-owned home sentinel changed');
    const status = run('git', ['-C', repo, 'status', '--short', '--untracked-files=all']);
    assert.doesNotMatch(status, /user-sentinel|user-owned-sentinel/u, 'Ignored user data must not be staged or reported');
    assert.match(status, /nested\/node_modules\/sentinel\.txt/u, 'Nested node_modules should remain visible to Git');
    return { rootDependencyIgnored: true, nestedDependencyVisible: true, bothLocksTrackable: true, userSentinelPreserved: true };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function verifyLockAndManifest(root = ROOT) {
  const packageBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
  const shrinkwrapBytes = fs.readFileSync(path.join(root, 'npm-shrinkwrap.json'));
  assert.ok(packageBytes.equals(shrinkwrapBytes), 'npm-shrinkwrap.json must be the byte-identical publication lock copied from package-lock.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(packageBytes.toString('utf8'));
  assert.equal(manifest.private, true, 'Public publish remains disabled for this local artifact');
  assert.equal(manifest.engines?.node, '>=24.21.0');
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages?.['']?.dependencies, manifest.dependencies, 'Development lock dependencies drifted from package manifest');
  assert.ok(manifest.files?.includes('npm-shrinkwrap.json'), 'Published artifact must carry its npm release lock');
  for (const required of ['bin/open-spec-mesh.js', 'lib/runtime/location.js', 'lib/workflow/cli.js', 'lib/observation/store.js', 'mcp/laya_http_mcp.js', 'install.sh']) {
    assert.ok(fs.existsSync(path.join(root, required)), `Required runtime resource missing: ${required}`);
  }
  return { private: manifest.private, engine: manifest.engines.node, lockfileVersion: lock.lockfileVersion, locksByteIdentical: true };
}

function verifyPack(root) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-pack-cache-'));
  try {
    const output = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache], { cwd: root });
    const data = JSON.parse(output);
    assert.equal(data.length, 1, 'Expected a single npm pack result');
    const files = new Set(data[0].files.map((item) => item.path));
    for (const required of ['package.json', 'npm-shrinkwrap.json', 'bin/open-spec-mesh.js', 'lib/runtime/location.js', 'install.sh']) {
      assert.ok(files.has(required), `Tarball packlist is missing ${required}`);
    }
    const forbidden = [...files].filter((file) => file.endsWith('.py') || file.includes('/node_modules/'));
    assert.deepEqual(forbidden, [], `Tarball contains Python or dependency-tree contents: ${forbidden.join(', ')}`);
    const sourceRuntime = walk(path.join(root, 'lib'), (file) => file.endsWith('.js')).map((file) => rel(file));
    const missing = sourceRuntime.filter((file) => !files.has(file));
    assert.deepEqual(missing, [], `Tarball omitted runtime modules: ${missing.join(', ')}`);
    return { entryCount: data[0].entryCount, files: [...files].sort() };
  } finally { fs.rmSync(cache, { recursive: true, force: true }); }
}

export function verifyStaticSource(root = ROOT) {
  const forbidden = /(?:path_contract|validate_changed_paths|changed_path_authoriz|Task Path Contract.*(?:required|allow|deny))/iu;
  const executableRoots = ['lib', 'bin', 'scripts', 'agents', ...fs.readdirSync(root).filter((name) => /^sdd-[^/]+$/u.test(name)).map((name) => `${name}/scripts`)];
  const scanned = executableRoots.flatMap((relative) => {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) return [];
    return walk(directory, (file) => file.endsWith('.js'));
  });
  const matches = [];
  for (const file of scanned) {
    if (['scripts/check_runtime.js', 'scripts/verify_coverage.js'].includes(rel(file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (forbidden.test(text)) matches.push(rel(file));
  }
  assert.deepEqual(matches, [], `Task path authorization logic leaked into active runtime: ${matches.join(', ')}`);
  const source = walk(root, (file) => file.endsWith('.js') && !file.includes(`${path.sep}node_modules${path.sep}`));
  const dynamicPython = [];
  for (const file of source) {
    if (rel(file) === 'scripts/check_runtime.js') continue; // Do not match this auditor's own detection regex.
    const text = fs.readFileSync(file, 'utf8');
    if (/spawn(?:Sync)?\([^\n]*\bpython3?\b|exec(?:Sync|File)?\([^\n]*\.py\b/iu.test(text)) dynamicPython.push(rel(file));
  }
  assert.deepEqual(dynamicPython, [], `Node consumer source calls a Python platform helper: ${dynamicPython.join(', ')}`);
  return { scannedRuntimeFiles: scanned.length, noPathGate: true, noPythonFallback: true };
}

export function verifyRuntime({ root = ROOT, syntax = true, pack = true } = {}) {
  const sourceFiles = walk(root, (file) => file.endsWith('.js') && !file.includes(`${path.sep}node_modules${path.sep}`));
  if (syntax) {
    for (const file of sourceFiles) run(process.execPath, ['--check', file], { cwd: root });
  }
  const python = verifyRetiredPythonSources(root);
  const source = verifyStaticSource(root);
  const locks = verifyLockAndManifest(root);
  const ignore = verifyRootIgnore(root);
  const packResult = pack ? verifyPack(root) : { skipped: true };
  process.stdout.write(`Runtime audit passed: syntax=${syntax ? sourceFiles.length : 'not-run'}, Python-exceptions=${python.retained.length}, package-files=${packResult.entryCount ?? 'not-run'}, lock=${locks.lockfileVersion}, static-files=${source.scannedRuntimeFiles}\n`);
  return { python, source, locks, ignore, package: packResult };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--mode', 'syntax', 'static', '--no-pack'].includes(arg))) {
    process.stderr.write('Usage: node scripts/check_runtime.js [--mode syntax|static] [--no-pack]\n');
    process.exitCode = 2;
  } else {
    const modeIndex = args.indexOf('--mode');
    const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'all';
    if (modeIndex >= 0 && !['syntax', 'static', 'all'].includes(mode)) {
      process.stderr.write('Unknown check mode; expected syntax, static, or all.\n');
      process.exitCode = 2;
    } else {
      try { verifyRuntime({ syntax: mode !== 'static', pack: !args.includes('--no-pack') }); }
      catch (error) { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; }
    }
  }
}
