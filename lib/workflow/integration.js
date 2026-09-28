import path from 'node:path';
import { mkdtempSync, readdirSync, lstatSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { context, document, contractDigest, revision, ancestor, git, readTextCompat, shaText } from './contract.js';
import { validateDelivery } from './contract.js';
import { planningComplete } from './readiness.js';
import { withProjectLock } from '../runtime/locks.js';
import { sha256 } from '../runtime/text.js';

function command(root, args) {
  const result = spawnSync('git', ['-C', String(root), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function nulSet(text) { return new Set(text.split('\0').filter(Boolean)); }
function dirtyPaths(root) {
  return new Set([...nulSet(git(root, 'diff', '--name-only', '-z', 'HEAD')), ...nulSet(git(root, 'ls-files', '--others', '--exclude-standard', '-z'))]);
}
function unmerged(root) { return [...nulSet(git(root, 'diff', '--name-only', '--diff-filter=U', '-z'))].sort(); }
function mergeAttempt(root, sha) { return command(root, ['merge', '--no-ff', '--no-commit', sha]); }
function codePointCompare(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
function changeSnapshot(change) {
  const rootStat = lstatSync(change);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Active Change must be a real directory');
  const files = new Map();
  const directories = new Map([['', rootStat.mode & 0o777]]);
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Active Change must not contain symlinks during integration');
      const relative = path.relative(change, file).split(path.sep).join('/');
      if (stat.isDirectory()) {
        directories.set(relative, stat.mode & 0o777);
        visit(file);
      } else if (stat.isFile()) files.set(relative, { bytes: readFileSync(file), mode: stat.mode & 0o777 });
    }
  };
  visit(change);
  return {
    files: new Map([...files].sort(([left], [right]) => codePointCompare(left, right))),
    directories: new Map([...directories].sort(([left], [right]) => codePointCompare(left, right))),
  };
}
function restoreChange(change, snapshot) {
  if (lstatSync(change, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Active Change must not be a symlink');
  rmSync(change, { recursive: true, force: true });
  mkdirSync(change, { recursive: true, mode: 0o700 });
  for (const [relative] of snapshot.directories) {
    if (!relative) continue;
    mkdirSync(path.join(change, ...relative.split('/')), { recursive: true, mode: 0o700 });
  }
  for (const [relative, { bytes, mode }] of snapshot.files) {
    const target = path.join(change, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes);
    chmodSync(target, mode);
  }
  const directories = [...snapshot.directories].sort(([left], [right]) => right.split('/').length - left.split('/').length || codePointCompare(right, left));
  for (const [relative, mode] of directories) chmodSync(relative ? path.join(change, ...relative.split('/')) : change, mode);
}
function cleanChangeToHead(root, change) {
  if (lstatSync(change, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Active Change must not be a symlink');
  const relative = path.relative(root, change).split(path.sep).join('/');
  rmSync(change, { recursive: true, force: true });
  const tracked = git(root, 'ls-tree', '-r', '--name-only', 'HEAD', '--', relative);
  if (tracked) git(root, 'restore', '--source=HEAD', '--worktree', '--', relative);
}
function abort(root) { command(root, ['merge', '--abort']); }
function registeredWorktrees(root) {
  return new Set(git(root, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length))));
}
function worktree(root, head, callback) {
  const parent = mkdtempSync(path.join(tmpdir(), 'sdd-integrate-'));
  const location = path.join(parent, 'preflight');
  let value;
  let operationError;
  try {
    git(root, 'worktree', 'add', '--detach', location, head);
    value = callback(location);
  } catch (error) {
    operationError = error;
  }

  let cleanupError;
  try {
    if (registeredWorktrees(root).has(path.resolve(location))) {
      // This directory is disposable only after Git confirms it is no longer a
      // registered worktree. If cleanup fails, retain it for manual recovery.
      try { command(location, ['merge', '--abort']); } catch { /* no merge is in progress */ }
      const removed = command(root, ['worktree', 'remove', '--force', location]);
      if (removed.error || removed.status !== 0) {
        const detail = removed.error?.message || `${removed.stderr ?? ''}${removed.stdout ?? ''}`.trim();
        throw new Error(`Could not remove temporary integration worktree; recovery data preserved at ${location}${detail ? `: ${detail}` : ''}`, { cause: removed.error });
      }
    }
    const stillRegistered = registeredWorktrees(root).has(path.resolve(location));
    if (!stillRegistered && !existsSync(location)) rmSync(parent, { recursive: true, force: true });
    else if (!cleanupError) cleanupError = new Error(`Temporary integration worktree was retained for recovery at ${location}`);
  } catch (error) {
    cleanupError = error;
  }

  if (operationError && cleanupError) throw new AggregateError([operationError, cleanupError], 'Integration preflight failed and temporary worktree cleanup also failed');
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return value;
}

export function validateAcceptedTask(root, changeId, taskId) {
  const { change, fields, task, directory, taskFields } = context(root, changeId, taskId);
  if (task.state !== 'accepted') throw new Error('Only accepted Tasks can be integrated');
  const reportPath = document(root, directory, taskFields, 'report');
  const report = readTextCompat(reportPath);
  const taskContract = readTextCompat(document(root, directory, taskFields, 'contract'));
  if (task.contract_digest !== contractDigest(root, change, fields, directory, taskFields)
      || task.report_digest !== sha256(Buffer.from(report, 'utf8'))
      || validateDelivery(root, task, report, taskContract) !== task.result_revision) throw new Error('Accepted Contract or report changed');
  return { change, task };
}

export function integrationCheck(root, changeId, taskId) {
  const { change, task } = validateAcceptedTask(root, changeId, taskId);
  const resultRevision = revision(root, task.result_revision);
  const head = revision(root, 'HEAD');
  if (ancestor(root, resultRevision, head)) return { change: changeId, task: taskId, integration: 'integrated', result_revision: resultRevision, head, conflicts: [] };
  const prefix = `${path.relative(root, change).split(path.sep).join('/').replace(/\/$/u, '')}/`;
  return worktree(root, head, (location) => {
    const completed = mergeAttempt(location, resultRevision);
    const conflicts = unmerged(location).filter((file) => !file.startsWith(prefix)).sort();
    if (completed.status !== 0 && !unmerged(location).length) {
      const detail = `${completed.stderr ?? ''}${completed.stdout ?? ''}`.trim();
      throw new Error(`Integration preflight failed${detail ? `: ${detail}` : ''}`);
    }
    return { change: changeId, task: taskId, integration: conflicts.length ? 'conflict' : 'ready', result_revision: resultRevision, head, conflicts };
  });
}
export function integrationWaveTasks(root, changeId) {
  const { graph } = context(root, changeId);
  return graph.tasks.filter((task) => task.state === 'accepted' && !ancestor(root, task.result_revision, revision(root, 'HEAD'))).map((task) => task.id);
}
export function integrationWaveCheck(root, changeId) {
  const taskIds = integrationWaveTasks(root, changeId);
  const head = revision(root, 'HEAD');
  if (!taskIds.length) return { change: changeId, integration: 'integrated', tasks: [], head, conflicts: [] };
  const change = context(root, changeId).change;
  const relative = path.relative(root, change).split(path.sep).join('/');
  const prefix = `${relative.replace(/\/$/u, '')}/`;
  const tasks = taskIds.map((id) => {
    const { task } = validateAcceptedTask(root, changeId, id);
    return [id, revision(root, task.result_revision)];
  });
  return worktree(root, head, (location) => {
    for (const [taskId, sha] of tasks) {
      if (ancestor(location, sha, revision(location, 'HEAD'))) continue;
      const completed = mergeAttempt(location, sha);
      const conflicts = unmerged(location);
      const external = conflicts.filter((file) => !file.startsWith(prefix)).sort();
      if (external.length) return { change: changeId, integration: 'conflict', tasks: taskIds, conflict_task: taskId, head, conflicts: external };
      if (completed.status !== 0 && !conflicts.length) {
        const detail = `${completed.stderr ?? ''}${completed.stdout ?? ''}`.trim();
        throw new Error(`Integration wave preflight failed${detail ? `: ${detail}` : ''}`);
      }
      cleanChangeToHead(location, path.join(location, relative));
      git(location, 'add', '-A', '--', relative);
      const remaining = unmerged(location);
      if (remaining.length) throw new Error(`Unresolved wave preflight conflicts: ${remaining.join(', ')}`);
      const commit = command(location, ['-c', 'user.name=Open Spec Mesh', '-c', 'user.email=open-spec-mesh@example.invalid', 'commit', '-m', `sdd preflight: ${taskId}`]);
      if (commit.status !== 0) throw new Error(commit.stderr.trim() || 'Wave preflight commit failed');
    }
    return { change: changeId, integration: 'ready', tasks: taskIds, head, conflicts: [] };
  });
}

export async function integrate(root, changeId, taskId, checkOnly = false) {
  return withProjectLock(root, () => {
    const { change, task } = validateAcceptedTask(root, changeId, taskId);
    const resultRevision = revision(root, task.result_revision);
    const head = revision(root, 'HEAD');
    if (ancestor(root, resultRevision, head)) return { change: changeId, task: taskId, integration: 'integrated', result_revision: resultRevision, head, conflicts: [] };
    const preflight = integrationCheck(root, changeId, taskId);
    if (checkOnly || preflight.integration === 'conflict') return preflight;
    const staged = [...nulSet(git(root, 'diff', '--cached', '--name-only', '-z'))].sort();
    if (staged.length) throw new Error(`Integration requires an empty Git index: ${staged.join(', ')}`);
    const prefix = `${path.relative(root, change).split(path.sep).join('/').replace(/\/$/u, '')}/`;
    const unexpected = [...dirtyPaths(root)].filter((file) => !file.startsWith(prefix)).sort();
    if (unexpected.length) throw new Error(`Commit or preserve non-Change edits before integration: ${unexpected.join(', ')}`);
    const snapshot = changeSnapshot(change);
    const relative = path.relative(root, change).split(path.sep).join('/');
    cleanChangeToHead(root, change);
    const completed = mergeAttempt(root, resultRevision);
    const conflicts = unmerged(root);
    const external = conflicts.filter((file) => !file.startsWith(prefix)).sort();
    if (external.length) {
      try { abort(root); } finally { restoreChange(change, snapshot); }
      throw new Error(`Integration conflicts require resolution: ${external.join(', ')}`);
    }
    if (completed.status !== 0 && !conflicts.length) {
      const detail = `${completed.stderr ?? ''}${completed.stdout ?? ''}`.trim();
      try { abort(root); } finally { restoreChange(change, snapshot); }
      throw new Error(`Integration failed${detail ? `: ${detail}` : ''}`);
    }
    try {
      restoreChange(change, snapshot);
      git(root, 'add', '-A', '--', relative);
      const remaining = unmerged(root);
      if (remaining.length) throw new Error(`Unresolved integration conflicts: ${remaining.join(', ')}`);
      const commit = command(root, ['commit', '-m', `sdd: integrate ${taskId}`]);
      if (commit.status !== 0) throw new Error(commit.stderr.trim() || 'Integration commit failed');
    } catch (error) {
      try { abort(root); } catch { /* merge may already be complete */ }
      restoreChange(change, snapshot);
      throw error;
    }
    const integratedHead = revision(root, 'HEAD');
    if (!ancestor(root, resultRevision, integratedHead)) throw new Error('Integration commit does not preserve Task result ancestry');
    return { change: changeId, task: taskId, integration: 'integrated', result_revision: resultRevision, head: integratedHead, conflicts: [] };
  });
}
export async function integrateWave(root, changeId, checkOnly = false) {
  const preflight = integrationWaveCheck(root, changeId);
  if (checkOnly || preflight.integration !== 'ready') return preflight;
  const results = [];
  for (const taskId of preflight.tasks) results.push(await integrate(root, changeId, taskId, false));
  return { change: changeId, integration: 'integrated', tasks: preflight.tasks, results, head: revision(root, 'HEAD'), conflicts: [] };
}
