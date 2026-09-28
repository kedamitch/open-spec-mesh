import { lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safePath, safeTree } from './tools.js';

function exists(pathname) {
  try { lstatSync(pathname); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function ensureDirectories(directory, created) {
  const missing = []; let cursor = path.resolve(directory);
  while (!exists(cursor)) { missing.push(cursor); const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
  safePath(cursor);
  const stat = lstatSync(cursor);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Expected a real directory: ${cursor}`);
  for (const target of missing.reverse()) { mkdirSync(target, { mode: 0o700 }); created.push(target); }
}

export function targetPath(home, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..')) {
    throw new Error(`Unsafe managed install path: ${relative}`);
  }
  const target = path.resolve(home, ...relative.split('/'));
  const rel = path.relative(path.resolve(home), target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`Managed install path escapes Home: ${relative}`);
  safePath(target);
  return target;
}

export function removePath(target) {
  safeTree(target);
  if (!exists(target)) return;
  const stat = lstatSync(target);
  if (stat.isDirectory() && !stat.isSymbolicLink()) rmSync(target, { recursive: true, force: false });
  else rmSync(target, { force: false });
}

export function createTransaction(home, { prefix = '.open-spec-mesh-install-' } = {}) {
  const parent = path.dirname(path.resolve(home));
  let anchor = parent;
  while (!exists(anchor)) {
    const next = path.dirname(anchor);
    if (next === anchor) throw new Error(`No existing transaction parent for ${home}`);
    anchor = next;
  }
  safePath(anchor);
  if (!lstatSync(anchor).isDirectory()) throw new Error(`Install transaction parent is not a directory: ${anchor}`);
  const root = mkdtempSync(path.join(anchor, prefix));
  mkdirSync(path.join(root, 'stage'), { mode: 0o700 });
  mkdirSync(path.join(root, 'rollback'), { mode: 0o700 });
  return Object.freeze({ root, stage: path.join(root, 'stage'), rollback: path.join(root, 'rollback') });
}

export function commitTransaction({ home, transaction, operations, faultInjector = null, reporter = () => {} }) {
  const moved = []; const installed = []; const createdDirectories = []; let retain = false;
  const backupFor = (relative) => path.join(transaction.rollback, ...relative.split('/'));
  try {
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]; const target = targetPath(home, operation.relative);
      const source = operation.source ?? null;
      if (source !== null) {
        safePath(source);
        const sourceStat = lstatSync(source);
        if (sourceStat.isSymbolicLink() || (!sourceStat.isFile() && !sourceStat.isDirectory())) throw new Error(`Unsafe staged asset: ${source}`);
      }
      if (exists(target)) {
        const backup = backupFor(operation.relative);
        ensureDirectories(path.dirname(backup), []);
        renameSync(target, backup);
        moved.push({ target, backup });
      }
      faultInjector?.('after-backup', index, operation);
      if (source !== null) {
        ensureDirectories(path.dirname(target), createdDirectories);
        faultInjector?.('before-publish', index, operation);
        renameSync(source, target);
        installed.push(target);
        faultInjector?.('after-publish', index, operation);
      }
    }
  } catch (error) {
    const failures = [];
    for (const target of installed.reverse()) {
      try { removePath(target); }
      catch (failure) { failures.push(`${target}: ${failure.message}`); }
    }
    for (const { target, backup } of moved.reverse()) {
      try {
        if (exists(target)) removePath(target);
        ensureDirectories(path.dirname(target), []);
        renameSync(backup, target);
      } catch (failure) { failures.push(`${target}: ${failure.message}`); }
    }
    for (const directory of createdDirectories.reverse()) {
      try { rmdirSync(directory); } catch (failure) { if (failure?.code !== 'ENOENT' && failure?.code !== 'ENOTEMPTY') failures.push(`${directory}: ${failure.message}`); }
    }
    if (failures.length) {
      retain = true;
      const failure = new Error(`Install failed and rollback is incomplete; recovery data retained at ${transaction.root}: ${failures.join('; ')}`, { cause: error });
      failure.recoveryPath = transaction.root;
      throw failure;
    }
    throw error;
  } finally {
    if (!retain) {
      try { rmSync(transaction.root, { recursive: true, force: true }); }
      catch (error) { reporter(`WARNING temporary cleanup failed: ${transaction.root}: ${error.message}`); }
    }
  }
}

export function safeHome(home) {
  const absolute = path.resolve(home);
  safePath(absolute);
  if (exists(absolute)) {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Host Home must be a directory: ${absolute}`);
  }
  return absolute;
}

export function inspectNonempty(directory) {
  safeTree(directory);
  return exists(directory) && readdirSync(directory).length > 0;
}

export function nearestExistingParent(target) {
  let cursor = path.dirname(path.resolve(target));
  while (!exists(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return os.tmpdir();
    cursor = parent;
  }
  return cursor;
}
