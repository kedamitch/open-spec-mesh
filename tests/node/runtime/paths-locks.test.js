import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { safeInside, rootPath } from '../../../lib/runtime/paths.js';
import { atomicWrite } from '../../../lib/runtime/io.js';
import { readTextCompat } from '../../../lib/runtime/text.js';
import { withProjectLock, recoverLock } from '../../../lib/runtime/locks.js';

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
