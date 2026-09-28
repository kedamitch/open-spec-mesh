import path from 'node:path';
import { isLosslessNumber, LosslessNumber } from 'lossless-json';
import { existsSync, lstatSync, mkdirSync, unlinkSync, readFileSync } from 'node:fs';
import { rootPath, context, document, contractDigest, git, revision, ancestor, event, saveGraph } from './contract.js';
import { planningComplete } from './readiness.js';
import { withProjectLock } from '../../lib/runtime/locks.js';
import { safeInside } from '../../lib/runtime/paths.js';
import { atomicWrite } from '../../lib/runtime/io.js';
import { readTextCompat } from '../../lib/runtime/text.js';
import { metadata } from '../../lib/documents/common.js';
import { graphSchema } from '../../lib/runtime/graph-schema.js';

function nextAttempt(value) {
  if (value === undefined) return 1;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Task attempt must be an exact integer');
  const raw = isLosslessNumber(value) ? value.toString() : String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new Error('Task attempt must be a non-negative integer');
  const next = BigInt(raw) + 1n;
  if (isLosslessNumber(value) || next > BigInt(Number.MAX_SAFE_INTEGER)) return new LosslessNumber(next.toString());
  return Number(next);
}

function realPathNoSymlink(value) {
  const absolute = path.resolve(value);
  for (let cursor = absolute; ; cursor = path.dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Workspace must not use symlinks'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
  return absolute;
}

export function sharedWorktree(root, location) {
  const absolute = realPathNoSymlink(location);
  const registered = new Set(git(root, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).map((line) => path.resolve(line.slice(9))));
  if (!registered.has(absolute)) throw new Error('Workspace is not registered in this repository');
  return absolute;
}

function planningPaths(root, change, fields, graphPath, graph) {
  const taskRoot = document(root, change, fields, 'tasks');
  const files = new Set([
    path.relative(root, path.join(change, 'index.md')),
    path.relative(root, document(root, change, fields, 'contract')),
    path.relative(root, path.join(taskRoot, 'index.md')),
    path.relative(root, graphPath),
  ]);
  if (fields.design) files.add(path.relative(root, document(root, change, fields, 'design')));
  for (const item of graph.tasks) {
    const dir = safeInside(root, path.relative(root, change), ...item.path.split('/'));
    const taskFields = metadata(readTextCompat(path.join(dir, 'index.md')))[0];
    files.add(path.relative(root, path.join(dir, 'index.md')));
    files.add(path.relative(root, document(root, dir, taskFields, 'contract')));
    files.add(path.relative(root, document(root, dir, taskFields, 'report')));
  }
  return files;
}
function dirtyPaths(root) {
  const tracked = git(root, 'diff', '--name-only', '-z', 'HEAD').split('\0');
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0');
  return new Set([...tracked, ...untracked].filter(Boolean));
}
export function requireDispatchableWorkspace(root, location, change, fields, graphPath, graph) {
  const planned = planningPaths(root, change, fields, graphPath, graph);
  const unexpected = [...dirtyPaths(location)].filter((item) => !planned.has(item));
  if (unexpected.length) throw new Error(`Commit or preserve implementation edits before dispatch; unrelated paths: ${unexpected.sort().join(', ')}`);
}
function writeRaw(file, text) { atomicWrite(file, Buffer.from(text, 'utf8'), { preserveMode: true }); }
function syncFiles(root, change, fields, graphPath, directory, taskFields, location, graph) {
  const sourceFiles = [
    path.join(change, 'index.md'), document(root, change, fields, 'contract'),
    path.join(path.dirname(directory), 'index.md'), path.join(directory, 'index.md'),
    document(root, directory, taskFields, 'contract'),
  ];
  if (fields.design) sourceFiles.push(document(root, change, fields, 'design'));
  const sourceReport = document(root, directory, taskFields, 'report');
  const targetReport = safeInside(location, path.relative(root, sourceReport));
  if (!existsSync(targetReport)) sourceFiles.push(sourceReport);
  const previous = [];
  try {
    for (const source of sourceFiles) {
      const target = safeInside(location, path.relative(root, source));
      mkdirSync(path.dirname(target), { recursive: true });
      previous.push([target, existsSync(target) ? readFileSync(target) : null]);
      writeRaw(target, readTextCompat(source));
    }
    const targetGraph = safeInside(location, path.relative(root, graphPath));
    previous.push([targetGraph, existsSync(targetGraph) ? readFileSync(targetGraph) : null]);
    graphSchema.save(targetGraph, graph);
    return previous;
  } catch (error) { restoreFiles(previous); throw error; }
}
function restoreFiles(previous) {
  for (const [file, bytes] of [...previous].reverse()) {
    if (bytes === null) { try { unlinkSync(file); } catch (error) { if (error?.code !== 'ENOENT') throw error; } }
    else atomicWrite(file, bytes, { preserveMode: true });
  }
}

export async function prepareWorkspace(rootValue, changeId, taskId, base = 'HEAD', worktree = null, reuse = false) {
  const root = rootPath(rootValue);
  return withProjectLock(root, async () => {
    const c = context(root, changeId, taskId);
    const { change, fields, graphPath, graph, task, directory, taskFields } = c;
    if (task.state !== 'planned' || task.contract_digest !== contractDigest(root, change, fields, directory, taskFields)) throw new Error('Main must approve the current Contract first');
    planningComplete(root, change, fields, directory, taskFields);
    const baseline = revision(root, base);
    for (const dep of task.depends_on) {
      const upstream = graph.tasks.find((item) => item.id === dep);
      if (upstream.state !== 'accepted' || !ancestor(root, upstream.result_revision, baseline)) throw new Error('Baseline must contain accepted dependency code');
    }
    const requested = worktree ?? (reuse ? task.workspace : null);
    const location = requested ? realPathNoSymlink(requested) : root;
    if (graph.tasks.some((item) => ['running', 'submitted'].includes(item.state) && item.workspace === location)) throw new Error('Active writer already uses this workspace');
    let created = false;
    let previous = [];
    try {
      if (location !== root) {
        if (existsSync(location)) {
          if (!reuse || task.workspace !== location) throw new Error("Reuse requires --reuse and the Task's original workspace");
          sharedWorktree(root, location);
          if (revision(location, 'HEAD') !== baseline) throw new Error('Integrate dependencies into the original worktree first; pass its HEAD as --base');
          requireDispatchableWorkspace(root, location, change, fields, graphPath, graph);
        } else {
          if (reuse) throw new Error('Original worktree is missing');
          git(root, 'worktree', 'add', '--detach', location, baseline);
          created = true;
        }
      } else if (revision(root, 'HEAD') !== baseline) throw new Error('Current checkout differs from baseline');
      else requireDispatchableWorkspace(root, location, change, fields, graphPath, graph);
      task.workspace = location;
      task.baseline = baseline;
      task.attempt = nextAttempt(task.attempt);
      event(task, 'running', { baseline, workspace: location, attempt: task.attempt });
      if (location !== root) previous = syncFiles(root, change, fields, graphPath, directory, taskFields, location, graph);
      saveGraph(graphPath, graph);
      return location;
    } catch (error) {
      restoreFiles(previous);
      if (created) { try { git(root, 'worktree', 'remove', '--force', location); } catch { /* preserve recovery evidence */ } }
      throw error;
    }
  });
}
