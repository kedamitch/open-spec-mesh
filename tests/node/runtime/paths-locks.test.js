import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, lstatSync, readFileSync, symlinkSync, existsSync, unlinkSync, rmdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { safeInside, rootPath } from '../../../lib/runtime/paths.js';
import { atomicWrite } from '../../../lib/runtime/io.js';
import { readTextCompat } from '../../../lib/runtime/text.js';
import { pathToFileURL } from 'node:url';
import { withLock, withProjectLock, withStoreLock, recoverLock } from '../../../lib/runtime/locks.js';

// TMPDIR is spelled through a symlink on macOS (/var -> /private/var); atomicWrite refuses any
// symlinked ancestor, so both the lock root and the test fixtures use the real path.
function lockRootDir() { return realpathSync(tmpdir()); }
function tempRoot() { return mkdtempSync(path.join(lockRootDir(), 'osm runtime test space ')); }

test('safe path resolution accepts spaces but rejects traversal and symlinks', (t) => {
  const root = tempRoot();
  mkdirSync(path.join(root, 'docs'));
  assert.equal(safeInside(root, 'docs', 'file name.md'), path.join(root, 'docs', 'file name.md'));
  assert.throws(() => safeInside(root, 'docs', '..', 'outside'), /escapes project/);
  const target = tempRoot();
  symlinkSync(target, path.join(root, 'linked'), 'dir');
  assert.throws(() => safeInside(root, 'linked', 'file.md'), /Symlink/);
  t.after(() => {});
});

test('atomic bytes replace in the same directory and preserve existing mode', () => {
  const root = tempRoot();
  const file = path.join(root, 'snapshot.json');
  writeFileSync(file, 'old');
  chmodSync(file, 0o640);
  atomicWrite(file, Buffer.from('new\n'), { preserveMode: true });
  assert.equal(readFileSync(file, 'utf8'), 'new\n');
  assert.equal(statSync(file).mode & 0o777, 0o640);
});

test('text read is UTF-8 strict and uses Python universal newlines', () => {
  const root = tempRoot();
  const file = path.join(root, 'lines.md');
  writeFileSync(file, Buffer.from('one\r\ntwo\rthree', 'utf8'));
  assert.equal(readTextCompat(file), 'one\ntwo\nthree');
  writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => readTextCompat(file));
});

test('project lock serializes concurrent same-process document writers', async () => {
  const root = rootPath(tempRoot());
  const order = [];
  await Promise.all([
    withProjectLock(root, async () => { order.push('first-start'); await new Promise((resolve) => setTimeout(resolve, 45)); order.push('first-end'); }),
    withProjectLock(root, async () => { order.push('second-start'); }),
  ]);
  assert.ok(order.indexOf('first-end') < order.indexOf('second-start'));
});


test('a lock contender waits for an incomplete owner publication without deleting the lock', async () => {
  const root = rootPath(tempRoot());
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const key = createHash('sha256').update(root, 'utf8').digest('hex');
  const lockDirectory = path.join(lockRootDir(), `open-spec-mesh-locks-${uid}`, 'store', `${key}.lock`);
  const ownerPath = path.join(lockDirectory, 'owner.json');
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const incomplete = Buffer.from('{"token":"initializing"', 'utf8');
  const token = 'deterministic-initialization-token';
  writeFileSync(ownerPath, incomplete, { mode: 0o600 });

  const worker = path.resolve('tests/node/runtime/lock-worker.js');
  const child = spawn(process.execPath, [worker, root, '0', 'store', 'announce'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(child, 'exit');
  const contending = new Promise((resolve, reject) => {
    const check = () => { if (stdout.includes('CONTENDING\n')) resolve(); };
    child.stdout.on('data', check);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!stdout.includes('CONTENDING\n')) reject(new Error(`worker exited before contention: ${code}: ${stderr}`));
    });
  });

  try {
    await contending;
    // Replace the deliberately partial owner atomically with the live fixture
    // owner's complete record, then release only this fixture lock.
    await new Promise((resolve) => setTimeout(resolve, 30));
    atomicWrite(ownerPath, Buffer.from(`${JSON.stringify({ token, pid: process.pid, namespace: 'store', target: root })}\n`), { mode: 0o600 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(child.exitCode, null, 'a live owner must keep the contender waiting');
    assert.equal(JSON.parse(readFileSync(ownerPath, 'utf8')).token, token);

    unlinkSync(ownerPath);
    rmdirSync(lockDirectory);
    const [code] = await exited;
    assert.equal(code, 0, stderr);
    assert.match(stdout, /LOCKED\n/u);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    if (existsSync(lockDirectory)) {
      try {
        const current = readFileSync(ownerPath);
        const owner = JSON.parse(current.toString('utf8'));
        if (current.equals(incomplete) || (owner.token === token && owner.pid === process.pid && owner.namespace === 'store' && owner.target === root)) {
          unlinkSync(ownerPath);
          rmdirSync(lockDirectory);
        }
      } catch { /* Preserve unexpected lock state for explicit recovery. */ }
    }
  }
});

test('a missing or persistently incomplete owner fails closed and preserves lock evidence', async () => {
  for (const [label, incomplete] of [['missing', null], ['incomplete', Buffer.from('{"token":', 'utf8')]]) {
    const root = rootPath(tempRoot());
    const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
    const key = createHash('sha256').update(root, 'utf8').digest('hex');
    const lockDirectory = path.join(lockRootDir(), `open-spec-mesh-locks-${uid}`, 'store', `${key}.lock`);
    const ownerPath = path.join(lockDirectory, 'owner.json');
    mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
    if (incomplete) writeFileSync(ownerPath, incomplete, { mode: 0o600 });

    try {
      await assert.rejects(withStoreLock(root, () => {}), /owner is missing or invalid; manual recovery is required/u, label);
      assert.equal(existsSync(lockDirectory), true);
      assert.equal(existsSync(ownerPath), incomplete !== null);
      if (incomplete) assert.deepEqual(readFileSync(ownerPath), incomplete);
    } finally {
      if (existsSync(lockDirectory)) {
        try {
          if (!existsSync(ownerPath)) rmdirSync(lockDirectory);
          else if (incomplete && readFileSync(ownerPath).equals(incomplete)) {
            unlinkSync(ownerPath);
            rmdirSync(lockDirectory);
          }
        } catch { /* Preserve unexpected lock state for explicit recovery. */ }
      }
    }
  }
});

test('killed lock owner remains fail-closed until exact-token recovery', async () => {
  const root = rootPath(tempRoot());
  const worker = path.resolve('tests/node/runtime/lock-worker.js');
  const child = spawn(process.execPath, [worker, root, '10000'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  const acquired = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.includes('LOCKED\n')) resolve(); });
    child.once('error', reject);
    child.once('exit', (code) => { if (!stdout.includes('LOCKED\n')) reject(new Error(`worker exited before lock: ${code}`)); });
  });
  await acquired;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  await assert.rejects(withProjectLock(root, () => {}), /explicit recovery required/);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const key = createHash('sha256').update(root, 'utf8').digest('hex');
  const ownerPath = path.join(lockRootDir(), `open-spec-mesh-locks-${uid}`, 'project', `${key}.lock`, 'owner.json');
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  assert.throws(() => recoverLock('project', root, owner.token), /writers-stopped/);
  const bin = path.resolve('bin/open-spec-mesh.js');
  const cli = spawnSync(process.execPath, [bin, 'recover-lock', '--root', root, '--owner-token', owner.token, '--writers-stopped'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), { recovered: true, namespace: 'project', target: root });
  await withProjectLock(root, () => 'ok');
});


test('a symlinked TMPDIR publishes the owner under the real lock root', async () => {
  const root = mkdtempSync(path.join(lockRootDir(), 'osm tmpdir link '));
  const real = path.join(root, 'real');
  const link = path.join(root, 'link');
  const target = path.join(root, 'target');
  mkdirSync(real);
  mkdirSync(target);
  symlinkSync(real, link, 'dir');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const key = createHash('sha256').update(rootPath(target), 'utf8').digest('hex');
  const lockDirectory = path.join(real, `open-spec-mesh-locks-${uid}`, 'install', `${key}.lock`);
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = link;
  try {
    // Re-import under the symlinked TMPDIR so the module-level lock root is recomputed.
    const moduleUrl = pathToFileURL(path.resolve('lib/runtime/locks.js')).href;
    const reloaded = await import(`${moduleUrl}?tmpdir=${encodeURIComponent(link)}`);
    let calls = 0;
    let held;
    await reloaded.withLock('install', target, async () => {
      calls += 1;
      held = JSON.parse(readFileSync(path.join(lockDirectory, 'owner.json'), 'utf8'));
    });
    assert.equal(calls, 1);
    assert.equal(held.namespace, 'install');
    assert.equal(held.target, rootPath(target));
    assert.equal(existsSync(lockDirectory), false);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a lock is not reentrant and is acquirable again after release', async () => {
  const root = rootPath(tempRoot());
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const key = createHash('sha256').update(root, 'utf8').digest('hex');
  const lockDirectory = path.join(lockRootDir(), `open-spec-mesh-locks-${uid}`, 'store', `${key}.lock`);
  const order = [];
  await withStoreLock(root, async () => {
    order.push('outer');
    await assert.rejects(withStoreLock(root, () => {}), /Lock is not reentrant/u);
    assert.equal(existsSync(path.join(lockDirectory, 'owner.json')), true);
  });
  assert.equal(existsSync(lockDirectory), false);
  await withStoreLock(root, async () => { order.push('again'); });
  assert.deepEqual(order, ['outer', 'again']);
});

function lockDirectoryFor(namespace, canonical) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const key = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return path.join(lockRootDir(), `open-spec-mesh-locks-${uid}`, namespace, `${key}.lock`);
}

function clearLockFixture(lockDirectory) {
  if (!existsSync(lockDirectory)) return;
  try { rmSync(path.join(lockDirectory, 'owner.json'), { force: true }); } catch { /* preserve evidence */ }
  try { rmdirSync(lockDirectory); } catch { /* preserve evidence */ }
}

// An ownerless lock directory is what a crash between the exclusive mkdir and the owner rename
// leaves behind. The path comes from the real lock rule: take the lock once to prove the derived
// directory is the one the module uses, then leave that directory behind with no owner record.
async function orphanLockFixture(namespace, root) {
  const lockDirectory = lockDirectoryFor(namespace, root);
  const ownerPath = path.join(lockDirectory, 'owner.json');
  let observed;
  await withLock(namespace, root, async () => { observed = JSON.parse(readFileSync(ownerPath, 'utf8')); });
  assert.equal(observed.namespace, namespace);
  assert.equal(observed.target, root);
  assert.equal(existsSync(lockDirectory), false);
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  return { lockDirectory, ownerPath };
}

test('(a) an ownerless lock directory fails closed without allowOrphan', async () => {
  const root = rootPath(tempRoot());
  const { lockDirectory } = await orphanLockFixture('install', root);
  try {
    assert.throws(
      () => recoverLock('install', root, 'any-token', { writersStopped: true }),
      /manual recovery is required/u,
    );
    assert.equal(existsSync(lockDirectory), true);
    assert.equal(existsSync(path.join(lockDirectory, 'owner.json')), false);
  } finally { clearLockFixture(lockDirectory); }
});

test('(b) allowOrphan removes the ownerless lock directory without a token', async () => {
  const root = rootPath(tempRoot());
  const { lockDirectory } = await orphanLockFixture('install', root);
  try {
    const result = recoverLock('install', root, undefined, { writersStopped: true, allowOrphan: true });
    assert.equal(result.recovered, true);
    assert.equal(result.orphan, true);
    assert.equal(result.namespace, 'install');
    assert.equal(result.target, root);
    assert.equal(result.directory, lockDirectory);
    assert.equal(existsSync(lockDirectory), false);
  } finally { clearLockFixture(lockDirectory); }
});

test('(c) allowOrphan never overrides a present owner record', async () => {
  const root = rootPath(tempRoot());
  const { lockDirectory, ownerPath } = await orphanLockFixture('install', root);
  try {
    writeFileSync(ownerPath, `${JSON.stringify({ token: 'fixture-token', pid: process.pid, namespace: 'install', target: root })}\n`, { mode: 0o600 });
    assert.throws(
      () => recoverLock('install', root, 'wrong-token', { writersStopped: true, allowOrphan: true }),
      /token or namespace does not match/u,
    );
    assert.throws(
      () => recoverLock('install', root, undefined, { writersStopped: true, allowOrphan: true }),
      /nonempty owner token is required/u,
    );
    assert.throws(
      () => recoverLock('install', root, 'fixture-token', { writersStopped: true, allowOrphan: true }),
      /still alive/u,
    );
    assert.equal(existsSync(ownerPath), true);
    assert.equal(existsSync(lockDirectory), true);
  } finally { clearLockFixture(lockDirectory); }
});

test('(d) every recovery path, orphan included, requires writersStopped', async () => {
  const root = rootPath(tempRoot());
  const { lockDirectory, ownerPath } = await orphanLockFixture('install', root);
  try {
    assert.throws(() => recoverLock('install', root, undefined, { allowOrphan: true }), /writers-stopped/u);
    assert.equal(existsSync(lockDirectory), true);
    writeFileSync(ownerPath, `${JSON.stringify({ token: 'fixture-token', pid: process.pid, namespace: 'install', target: root })}\n`, { mode: 0o600 });
    assert.throws(() => recoverLock('install', root, 'fixture-token'), /writers-stopped/u);
    assert.equal(existsSync(ownerPath), true);
  } finally { clearLockFixture(lockDirectory); }
});

// A crash can leave more than an empty directory: a half-written owner temp file, an abandoned
// scratch directory, or a link someone dropped in. --force clears only the first two shapes.
test('(e) allowOrphan clears first-level regular files and empty subdirectories', async () => {
  const root = rootPath(tempRoot());
  const { lockDirectory } = await orphanLockFixture('install', root);
  try {
    writeFileSync(path.join(lockDirectory, 'owner.json.1234.abcd.tmp'), 'half written\n', { mode: 0o600 });
    mkdirSync(path.join(lockDirectory, 'scratch'), { mode: 0o700 });
    const result = recoverLock('install', root, undefined, { writersStopped: true, allowOrphan: true });
    assert.equal(result.recovered, true);
    assert.equal(result.orphan, true);
    assert.equal(result.namespace, 'install');
    assert.equal(result.target, root);
    assert.equal(result.directory, lockDirectory);
    assert.deepEqual(result.removed, ['owner.json.1234.abcd.tmp', 'scratch']);
    assert.equal(existsSync(lockDirectory), false);
  } finally { rmSync(lockDirectory, { recursive: true, force: true }); }
});

test('(f) allowOrphan refuses a symlink and leaves the whole directory untouched', async () => {
  const root = rootPath(tempRoot());
  const outside = tempRoot();
  const { lockDirectory } = await orphanLockFixture('install', root);
  const linkPath = path.join(lockDirectory, 'escape');
  try {
    writeFileSync(path.join(outside, 'keep.txt'), 'must survive\n');
    symlinkSync(path.join(outside, 'keep.txt'), linkPath);
    writeFileSync(path.join(lockDirectory, 'removable.tmp'), 'clearable\n', { mode: 0o600 });
    assert.throws(
      () => recoverLock('install', root, undefined, { writersStopped: true, allowOrphan: true }),
      /will not remove[\s\S]*escape/u,
    );
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'must survive\n');
    // The refusal is decided before any removal, so a clearable neighbour survives too.
    assert.equal(existsSync(path.join(lockDirectory, 'removable.tmp')), true);
    assert.equal(existsSync(lockDirectory), true);
  } finally {
    rmSync(lockDirectory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('(g) allowOrphan refuses a non-empty subdirectory and preserves its contents', async () => {
  const root = rootPath(tempRoot());
  const { lockDirectory } = await orphanLockFixture('install', root);
  const nested = path.join(lockDirectory, 'nested');
  try {
    mkdirSync(nested, { mode: 0o700 });
    writeFileSync(path.join(nested, 'evidence.txt'), 'keep me\n', { mode: 0o600 });
    writeFileSync(path.join(lockDirectory, 'removable.tmp'), 'clearable\n', { mode: 0o600 });
    assert.throws(
      () => recoverLock('install', root, undefined, { writersStopped: true, allowOrphan: true }),
      /will not remove[\s\S]*nested/u,
    );
    assert.equal(readFileSync(path.join(nested, 'evidence.txt'), 'utf8'), 'keep me\n');
    assert.equal(existsSync(path.join(lockDirectory, 'removable.tmp')), true);
    assert.equal(existsSync(lockDirectory), true);
  } finally { rmSync(lockDirectory, { recursive: true, force: true }); }
});

test('(i) allowOrphan refuses a special file and preserves it', (t) => {
  if (process.platform === 'win32') return t.skip('mkfifo is POSIX only');
  const root = rootPath(tempRoot());
  return (async () => {
    const { lockDirectory } = await orphanLockFixture('install', root);
    const fifo = path.join(lockDirectory, 'pipe');
    try {
      const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
      if (made.status !== 0) { t.skip(`mkfifo unavailable: ${made.error?.message ?? made.stderr}`); return; }
      writeFileSync(path.join(lockDirectory, 'removable.tmp'), 'clearable\n', { mode: 0o600 });
      assert.throws(
        () => recoverLock('install', root, undefined, { writersStopped: true, allowOrphan: true }),
        /will not remove[\s\S]*pipe/u,
      );
      assert.equal(lstatSync(fifo).isFIFO(), true);
      assert.equal(existsSync(path.join(lockDirectory, 'removable.tmp')), true);
    } finally { rmSync(lockDirectory, { recursive: true, force: true }); }
  })();
});

test('(h) recover-lock --force clears leftovers through the CLI and still refuses an owner record', async () => {
  const home = rootPath(tempRoot());
  const bin = path.resolve('bin/osm.js');
  const { lockDirectory, ownerPath } = await orphanLockFixture('install', home);
  try {
    writeFileSync(path.join(lockDirectory, 'owner.json.dead.tmp'), 'stale\n', { mode: 0o600 });
    mkdirSync(path.join(lockDirectory, 'scratch'), { mode: 0o700 });
    const cli = spawnSync(process.execPath, [bin, 'recover-lock', '--home', home, '--force', '--writers-stopped'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), `recovered orphan lock: ${lockDirectory}`);
    assert.equal(existsSync(lockDirectory), false);

    // A live owner record is never reachable from --force, whatever else the directory holds.
    mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(ownerPath, `${JSON.stringify({ token: 'fixture-token', pid: process.pid, namespace: 'install', target: home })}\n`, { mode: 0o600 });
    const refused = spawnSync(process.execPath, [bin, 'recover-lock', '--home', home, '--force', '--writers-stopped'], { encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /A nonempty owner token is required/u);
    assert.equal(existsSync(ownerPath), true);
    assert.equal(existsSync(lockDirectory), true);
  } finally { rmSync(lockDirectory, { recursive: true, force: true }); }
});
