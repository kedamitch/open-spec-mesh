import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, readFileSync, symlinkSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { safeInside, rootPath } from '../../../lib/runtime/paths.js';
import { atomicWrite } from '../../../lib/runtime/io.js';
import { readTextCompat } from '../../../lib/runtime/text.js';
import { withProjectLock, withStoreLock, recoverLock } from '../../../lib/runtime/locks.js';

function tempRoot() { return mkdtempSync(path.join(tmpdir(), 'osm runtime test space ')); }

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
  const lockDirectory = path.join(tmpdir(), `open-spec-mesh-locks-${uid}`, 'store', `${key}.lock`);
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
    const lockDirectory = path.join(tmpdir(), `open-spec-mesh-locks-${uid}`, 'store', `${key}.lock`);
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
  const ownerPath = path.join(tmpdir(), `open-spec-mesh-locks-${uid}`, 'project', `${key}.lock`, 'owner.json');
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  assert.throws(() => recoverLock('project', root, owner.token), /writers-stopped/);
  const bin = path.resolve('bin/open-spec-mesh.js');
  const cli = spawnSync(process.execPath, [bin, 'recover-lock', '--root', root, '--owner-token', owner.token, '--writers-stopped'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), { recovered: true, namespace: 'project', target: root });
  await withProjectLock(root, () => 'ok');
});
