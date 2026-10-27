import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { safeInside } from './paths.js';
import { atomicWrite } from './io.js';

const NAMESPACES = new Set(['project', 'install', 'store']);
const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
// The lock root must be a real path: atomicWrite rejects any symlinked ancestor, and on
// macOS os.tmpdir() is /var/folders/... where /var links to /private/var. This normalizes
// only the lock's own root; user target paths keep their full symlink protections.
const tmpRoot = (() => {
  const candidate = os.tmpdir();
  try { return realpathSync(candidate); }
  catch { return candidate; }
})();
const lockBase = path.join(tmpRoot, `open-spec-mesh-locks-${uid}`);
const lockContext = new AsyncLocalStorage();
const OWNER_PUBLICATION_GRACE_MS = 1_000;
const OWNER_POLL_INTERVAL_MS = 10;

function canonicalTarget(target) {
  const absolute = path.resolve(target);
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Lock target must not be a symlink: ${absolute}`);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const realParent = realpathSync(path.dirname(absolute));
  return path.join(realParent, path.basename(absolute));
}

function lockPath(namespace, target) {
  if (!NAMESPACES.has(namespace)) throw new Error(`Unknown lock namespace: ${namespace}`);
  const canonical = canonicalTarget(target);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return { canonical, directory: path.join(lockBase, namespace, `${digest}.lock`) };
}

function ensureLockParent(lockDirectory) {
  const namespaceDirectory = path.dirname(lockDirectory);
  for (const directory of [lockBase, namespaceDirectory]) {
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  for (const directory of [lockBase, namespaceDirectory]) {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe lock directory: ${directory}`);
  }
}

async function readPublishedOwner(lock, ownerPath) {
  const deadline = performance.now() + OWNER_PUBLICATION_GRACE_MS;
  let incomplete;
  while (true) {
    try {
      const directoryStat = lstatSync(lock.directory);
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error(`Lock directory is unsafe: ${lock.directory}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }

    let ownerStat;
    try { ownerStat = lstatSync(ownerPath); }
    catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Lock owner is invalid; manual recovery is required: ${lock.directory}`, { cause: error });
      }
      incomplete = error;
    }

    if (ownerStat) {
      if (ownerStat.isSymbolicLink() || !ownerStat.isFile()) {
        throw new Error(`Lock owner is unsafe; refusing acquisition: ${lock.directory}`);
      }
      try { return JSON.parse(readFileSync(ownerPath, 'utf8')); }
      catch (error) {
        // A competing publisher may have created the file but not finished writing it.
        // New writers publish via atomic rename; tolerate an in-flight legacy write, but
        // never treat elapsed time as permission to acquire or remove the lock.
        if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
          throw new Error(`Lock owner is invalid; manual recovery is required: ${lock.directory}`, { cause: error });
        }
        incomplete = error;
      }
    }

    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(`Lock owner is missing or invalid; manual recovery is required: ${lock.directory}`, { cause: incomplete });
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(OWNER_POLL_INTERVAL_MS, remaining)));
  }
}

export async function withLock(namespace, target, fn) {
  if (typeof fn !== 'function') throw new TypeError('Lock callback must be a function');
  const lock = lockPath(namespace, target);
  ensureLockParent(lock.directory);
  const lockKey = lock.directory;
  if (lockContext.getStore()?.has(lockKey)) throw new Error(`Lock is not reentrant: ${lock.directory}`);

  const ownerPath = path.join(lock.directory, 'owner.json');
  let token;
  while (true) {
    try {
      mkdirSync(lock.directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      const owner = await readPublishedOwner(lock, ownerPath);
      if (owner === null) continue;
      if (owner.namespace !== namespace || owner.target !== lock.canonical || typeof owner.token !== 'string' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
        throw new Error(`Lock owner does not match the requested resource; refusing acquisition: ${lock.directory}`);
      }
      let alive = false;
      try { process.kill(owner.pid, 0); alive = true; }
      catch (ownerError) {
        if (ownerError?.code === 'ESRCH') throw new Error(`Lock owner process is gone; explicit recovery required (${owner.pid}): ${lock.directory}`);
        if (ownerError?.code === 'EPERM') alive = true;
        else throw ownerError;
      }
      if (alive) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      continue;
    }

    token = randomUUID();
    try {
      atomicWrite(
        ownerPath,
        Buffer.from(`${JSON.stringify({ token, pid: process.pid, namespace, target: lock.canonical })}\n`, 'utf8'),
        { mode: 0o600 },
      );
    } catch (error) {
      // Keep the exclusive directory as recovery evidence. Never remove a lock whose
      // owner publication failed, since another process may already have observed it.
      throw new Error(`Lock owner could not be published; manual recovery is required: ${lock.directory}`, { cause: error });
    }
    break;
  }

  const release = () => {
    const ownerStat = lstatSync(ownerPath);
    if (ownerStat.isSymbolicLink() || !ownerStat.isFile()) throw new Error(`Lock owner changed; refusing release: ${lock.directory}`);
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    if (owner.token !== token || owner.namespace !== namespace || owner.target !== lock.canonical) {
      throw new Error(`Lock owner changed; refusing release: ${lock.directory}`);
    }
    rmSync(ownerPath);
    rmdirSync(lock.directory);
  };

  const parentContext = lockContext.getStore() ?? new Set();
  const currentContext = new Set(parentContext);
  currentContext.add(lockKey);
  try {
    return await lockContext.run(currentContext, fn);
  } finally {
    release();
  }
}
export const withProjectLock = (root, fn) => withLock('project', root, fn);
export const withInstallLock = (home, fn) => withLock('install', home, fn);
export const withStoreLock = (dbPath, fn) => withLock('store', dbPath, fn);

// `--force` may clear only what it can recognise without following a link. Each entry is
// re-checked against its real type immediately before removal, and removal stays non-recursive.
function safeOrphanEntryName(name) {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..'
    && path.basename(name) === name && !/[/\\\0]/u.test(name);
}

function classifyOrphanEntry(lockDirectory, name) {
  const absolute = path.join(lockDirectory, name);
  let entryStat;
  try { entryStat = lstatSync(absolute); }
  catch (error) { if (error?.code === 'ENOENT') return 'gone'; throw error; }
  if (entryStat.isSymbolicLink()) return 'blocked';
  if (entryStat.isFile()) return 'file';
  if (entryStat.isDirectory()) {
    try { return readdirSync(absolute).length === 0 ? 'empty-directory' : 'blocked'; }
    catch (error) { if (error?.code === 'ENOENT') return 'gone'; throw error; }
  }
  return 'blocked';
}

function clearedNote(removed) {
  if (removed.length === 0) return '';
  return `; already removed ${removed.length} leftover ${removed.length === 1 ? 'entry' : 'entries'} (${removed.join(', ')})`;
}

function clearOrphanLockDirectory(lock, ownerPath) {
  // Re-assert the directory identity the caller already checked: every path below is built from
  // this directory plus one readdir name, so it must not have become a link to somewhere else.
  const directoryStat = lstatSync(lock.directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error(`Lock directory is unsafe: ${lock.directory}`);
  const plan = [];
  const blocked = [];
  for (const name of readdirSync(lock.directory).sort()) {
    if (!safeOrphanEntryName(name)) { blocked.push(JSON.stringify(name)); continue; }
    // An owner record is never clearable content: its presence means this directory is no longer an
    // orphan, whatever the earlier check saw.
    if (name === 'owner.json') { blocked.push(name); continue; }
    const kind = classifyOrphanEntry(lock.directory, name);
    if (kind === 'gone') continue;
    if (kind === 'blocked') { blocked.push(name); continue; }
    plan.push([name, kind]);
  }
  // Nothing at all is removed unless the whole directory is clearable, so an unremovable leftover
  // leaves the evidence exactly as the operator found it.
  if (blocked.length > 0) {
    throw new Error(`Orphan lock directory contains entries that --force will not remove (an owner record, symlinks, special files, non-empty directories and unexpected names require manual handling): ${lock.directory}; left in place: ${blocked.join(', ')}`);
  }

  const removed = [];
  const assertOwnerAbsent = () => {
    try { lstatSync(ownerPath); }
    catch (error) {
      if (error?.code === 'ENOENT') return;
      throw new Error(`Lock owner could not be checked; manual recovery is required: ${lock.directory}`, { cause: error });
    }
    throw new Error(`Lock owner appeared while clearing the orphan lock directory; refusing to remove a lock with an owner record: ${lock.directory}${clearedNote(removed)}`);
  };

  for (const [name, planned] of plan) {
    assertOwnerAbsent();
    const absolute = path.join(lock.directory, name);
    const current = classifyOrphanEntry(lock.directory, name);
    if (current === 'gone') continue;
    if (current !== planned) {
      throw new Error(`Orphan lock entry changed while clearing; manual recovery is required: ${absolute} (expected ${planned}, found ${current})${clearedNote(removed)}`);
    }
    try {
      if (planned === 'file') unlinkSync(absolute);
      else rmdirSync(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`Orphan lock entry could not be removed; manual recovery is required: ${absolute}${clearedNote(removed)}`, { cause: error });
    }
    removed.push(name);
  }

  assertOwnerAbsent();
  try { rmdirSync(lock.directory); }
  catch (error) {
    throw new Error(`Orphan lock directory could not be removed; manual recovery is required: ${lock.directory}${clearedNote(removed)}`, { cause: error });
  }
  return removed;
}

export function recoverLock(namespace, target, ownerToken, { writersStopped = false, allowOrphan = false } = {}) {
  if (!writersStopped) throw new Error('Lock recovery requires explicit --writers-stopped confirmation');
  const lock = lockPath(namespace, target);
  const ownerPath = path.join(lock.directory, 'owner.json');
  const dirStat = lstatSync(lock.directory);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error('Lock directory is unsafe');
  let ownerStat;
  try { ownerStat = lstatSync(ownerPath); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('Lock owner is missing or unsafe; manual recovery is required', { cause: error });
    if (!allowOrphan) {
      throw new Error('Lock owner is missing or unsafe; manual recovery is required (if no process holds this resource, re-run with --force to remove the ownerless lock directory)');
    }
    // The missing owner record is the only evidence for removing anything here, so the
    // removal is never recursive: a writer that publishes owner.json in this window makes the
    // removal stop instead of destroying a live lock. Only first-level regular files and empty
    // subdirectories are cleared; every other entry keeps the directory intact.
    let removed = [];
    try { rmdirSync(lock.directory); }
    catch (removeError) {
      if (removeError?.code !== 'ENOTEMPTY' && removeError?.code !== 'EEXIST') {
        throw new Error(`Orphan lock directory could not be removed; manual recovery is required: ${lock.directory}`, { cause: removeError });
      }
      removed = clearOrphanLockDirectory(lock, ownerPath);
    }
    return { recovered: true, orphan: true, directory: lock.directory, namespace, target: lock.canonical, removed };
  }
  if (ownerStat.isSymbolicLink() || !ownerStat.isFile()) throw new Error('Lock owner is missing or unsafe; manual recovery is required');
  if (typeof ownerToken !== 'string' || !ownerToken) throw new Error('A nonempty owner token is required');
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  if (owner.namespace !== namespace || owner.target !== lock.canonical || owner.token !== ownerToken) {
    throw new Error('Lock owner token or namespace does not match');
  }
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Lock owner PID is invalid; manual recovery is required');
  try {
    process.kill(owner.pid, 0);
    throw new Error(`Lock owner process is still alive: ${owner.pid}`);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  rmSync(ownerPath);
  rmdirSync(lock.directory);
  return { recovered: true, namespace, target: lock.canonical };
}

export function lockTargetForPath(root, relative) {
  return safeInside(root, relative);
}
