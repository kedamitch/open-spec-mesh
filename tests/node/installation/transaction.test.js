import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { commitTransaction, createTransaction, targetPath } from '../../../lib/installation/transaction.js';
import { tempDirectory } from './helpers.js';

test('install transaction restores prior assets in reverse order after a publication fault', (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'home');
  mkdirSync(path.join(home, 'skills', 'sdd-do'), { recursive: true });
  writeFileSync(path.join(home, 'skills', 'sdd-do', 'SKILL.md'), 'old bytes\n');
  const transaction = createTransaction(home);
  const staged = path.join(transaction.stage, 'sdd-do');
  mkdirSync(staged, { recursive: true });
  writeFileSync(path.join(staged, 'SKILL.md'), 'new bytes\n');
  assert.throws(() => commitTransaction({
    home, transaction, operations: [{ relative: 'skills/sdd-do', source: staged }],
    faultInjector(phase) { if (phase === 'after-publish') throw new Error('injected publish fault'); },
  }), /injected publish fault/);
  assert.equal(readFileSync(path.join(home, 'skills/sdd-do/SKILL.md'), 'utf8'), 'old bytes\n');
  assert.equal(existsSync(transaction.root), false);
});

test('incomplete rollback retains a recovery directory and reports its path', (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, 'managed.txt'), 'old bytes');
  const transaction = createTransaction(home);
  const staged = path.join(transaction.stage, 'managed.txt');
  writeFileSync(staged, 'new bytes');
  let movedBackup = false;
  let failure;
  try {
    commitTransaction({ home, transaction, operations: [{ relative: 'managed.txt', source: staged }], faultInjector(phase) {
      if (phase === 'after-backup' && !movedBackup) {
        movedBackup = true;
        const backup = path.join(transaction.rollback, 'managed.txt');
        renameSync(backup, path.join(transaction.root, 'preserved-old-data'));
        throw new Error('force rollback failure');
      }
    } });
  } catch (error) { failure = error; }
  assert.equal(typeof failure?.recoveryPath, 'string');
  assert.equal(failure.recoveryPath, transaction.root);
  assert.equal(existsSync(transaction.root), true);
  assert.equal(readFileSync(path.join(transaction.root, 'preserved-old-data'), 'utf8'), 'old bytes');
});

test('managed target path rejects traversal and symlink components', (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'home');
  mkdirSync(home);
  assert.throws(() => targetPath(home, '../outside'), /Unsafe managed install path/);
  const link = path.join(home, 'skills');
  symlinkSync(root, link, 'dir');
  assert.throws(() => targetPath(home, 'skills/sdd-do'), /Refusing symlink/);
});
