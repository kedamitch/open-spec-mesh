import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { legacyJson, parseLosslessJson } from '../runtime/compat-json.js';
import { fileText, select, sddArtifacts, snapshot } from '../observation/collect.js';
import { diagnose, markdown, summary } from '../observation/diagnose.js';
import { readRollout, ROLES } from '../observation/trace.js';

export const VERSION = 1;
export const MAX_FILES = 10000;
export const MAX_ROOTS = 200;
export const MAX_TRACES = 300;
export const MAX_TRACE_BYTES = 128 * 1024 * 1024;
export const MAX_OUTPUT = 32 * 1024 * 1024;
export const MAX_HEADER = 8 * 1024 * 1024;

export const sha = (value) => createHash('sha256').update(value).digest('hex');

export async function safePath(value) {
  const absolute = path.resolve(String(value));
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new TypeError('symlink_path_refused'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return absolute;
}

export async function projectRoot(value) {
  let root = await safePath(value);
  const stat = await lstat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new TypeError('project_missing');
  for (let current = root; ; current = path.dirname(current)) {
    try { await lstat(path.join(current, '.git')); root = current; break; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  if (root === path.parse(root).root || root === path.resolve(process.env.HOME ?? process.cwd())) throw new TypeError('select_a_project_not_home');
  return root;
}

async function readHeader(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError('header_unreadable');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(MAX_HEADER + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const newline = bytes.indexOf(10);
    const end = newline < 0 ? bytes.length : newline;
    if (end > MAX_HEADER) throw new RangeError('header_limit');
    return { row: parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))), bytes: end };
  } finally { await handle.close(); }
}

async function walkJsonl(directory, issues, cap = MAX_FILES) {
  const result = [];
  let seen = 0;
  let limitReached = false;
  const walk = async (folder) => {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (limitReached) return;
      if (entry.isSymbolicLink()) { issues.symlink_skipped = (issues.symlink_skipped ?? 0) + 1; continue; }
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (seen >= cap) { issues.file_index_limit = (issues.file_index_limit ?? 0) + 1; limitReached = true; return; }
        seen += 1;
        result.push(file);
      }
    }
  };
  await walk(directory);
  return result;
}

export async function discover(project, directory) {
  directory = await safePath(directory);
  const issues = Object.create(null);
  const indexed = new Map();
  const roots = [];
  const duplicates = new Set();
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) throw new TypeError('symlink_path_refused');
    if (!stat.isDirectory()) throw new TypeError('sessions_not_directory');
  } catch (error) {
    if (error?.code === 'ENOENT') return [indexed, roots, { sessions_missing: 1 }];
    throw error;
  }
  let headerBytes = 0;
  const paths = await walkJsonl(directory, issues);
  for (const file of paths) {
    try {
      const { row, bytes } = await readHeader(file);
      headerBytes += bytes + (bytes > 0 ? 1 : 0);
      if (headerBytes > 32 * 1024 * 1024) { issues.header_bytes_limit = (issues.header_bytes_limit ?? 0) + 1; break; }
      if (!row || row.type !== 'session_meta') { issues.unsupported_header = (issues.unsupported_header ?? 0) + 1; continue; }
      const meta = row.payload;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new TypeError('metadata_shape');
      const id = meta.id;
      if (typeof id !== 'string' || !id || id.length > 128) throw new TypeError('session_identity');
      if (indexed.has(id) || duplicates.has(id)) { indexed.delete(id); duplicates.add(id); issues.duplicate_session = (issues.duplicate_session ?? 0) + 1; continue; }
      indexed.set(id, file);
      if (meta.agent_role != null && typeof meta.agent_role !== 'string') throw new TypeError('invalid_agent_role');
      if (typeof meta.cwd !== 'string' || !path.isAbsolute(meta.cwd)) continue;
      const cwd = await safePath(meta.cwd);
      const rel = path.relative(path.resolve(project), cwd);
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
      if (meta.parent_thread_id || (typeof meta.agent_role === 'string' && ROLES.has(meta.agent_role) && meta.agent_role !== 'main')) continue;
      if (meta.source && typeof meta.source === 'object' && Object.hasOwn(meta.source, 'subagent')) continue;
      roots.push({ mtime: (await lstat(file)).mtimeMs, id, file });
    } catch { issues.header_unreadable = (issues.header_unreadable ?? 0) + 1; }
  }
  roots.sort((a, b) => b.mtime - a.mtime || b.id.localeCompare(a.id));
  if (roots.length > MAX_ROOTS) issues.root_index_limit = roots.length - MAX_ROOTS;
  return [indexed, roots.filter((root) => !duplicates.has(root.id)).slice(0, MAX_ROOTS), issues];
}

function parseNow(now) { return now instanceof Date ? now : new Date(now); }

export async function collectRecent(project, home, sessionsDirectory, rulesRoot, days = 7, limit = 20, expectedMode = 'unknown', expectedRoles = [], { now = new Date(), skillFile = null } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 90 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('invalid_window_or_limit');
  const current = parseNow(now);
  const cutoff = new Date(current.getTime() - days * 86400000).toISOString();
  const [indexed, roots, issues] = await discover(project, sessionsDirectory);
  const cache = new Map(), failed = new Set();
  let traceBytes = 0;
  const parsed = async (id) => {
    if (failed.has(id)) return null;
    if (!cache.has(id)) {
      if (cache.size + failed.size >= MAX_TRACES) { issues.trace_limit = (issues.trace_limit ?? 0) + 1; return null; }
      try {
        const file = indexed.get(id);
        const size = (await lstat(file)).size;
        if (traceBytes + size > MAX_TRACE_BYTES) { issues.trace_bytes_limit = (issues.trace_bytes_limit ?? 0) + 1; return null; }
        traceBytes += size;
        const result = await readRollout(file);
        if (result.id !== id) throw new TypeError('session_identity_changed');
        cache.set(id, result);
      } catch { failed.add(id); issues.trace_unreadable = (issues.trace_unreadable ?? 0) + 1; return null; }
    }
    return cache.get(id);
  };
  const slices = [];
  for (const root of roots) {
    const trace = await parsed(root.id);
    if (!trace) continue;
    for (const turn of trace.turns.length ? trace.turns : [null]) {
      const starts = trace.events.filter((event) => event.turn === turn && event.kind === 'turn.start' && event.at).map((event) => event.at);
      if (!starts.length) { issues.turn_timestamp_missing = (issues.turn_timestamp_missing ?? 0) + 1; continue; }
      if (starts[0] > current.toISOString()) { issues.future_turn_timestamp = (issues.future_turn_timestamp ?? 0) + 1; continue; }
      if (starts[0] >= cutoff) slices.push({ at: starts[0], id: root.id, turn });
    }
  }
  slices.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id) || String(b.turn ?? '').localeCompare(String(a.turn ?? '')));
  const omitted = Math.max(0, slices.length - limit);
  const selected = slices.slice(0, limit);
  const inventory = await snapshot(project, rulesRoot);
  const selectedSkillFile = skillFile ?? fileURLToPath(new URL('../../sdd-diagnose/SKILL.md', import.meta.url));
  let skillText;
  try { skillText = await fileText(selectedSkillFile); }
  catch { skillText = '# sdd-diagnose\n'; }
  inventory.push({ path: 'collector/sdd-diagnose/SKILL.md', status: 'present', digest: sha(skillText), bytes: Buffer.byteLength(skillText), evidence: 'collector_version_not_historical_loading' });
  const fingerprint = sha(legacyJson(inventory.map((item) => [item.path, item.digest ?? null]), { sortKeys: true }));
  const runs = [];
  for (const { id, turn } of selected) {
    const trace = cache.get(id), candidates = [], visited = new Set([id]);
    try {
      let sessions, events, coverage;
      while (true) {
        [sessions, events, coverage] = select(trace, candidates, turn);
        const children = new Set(events.filter((event) => event.status === 'success' && ['agent.spawn', 'agent.resume', 'agent.message'].includes(event.fact?.kind)).map((event) => event.fact.child).filter(Boolean));
        const pending = [...children].filter((child) => !visited.has(child)).sort();
        if (!pending.length) break;
        for (const child of pending) {
          visited.add(child);
          if (indexed.has(child)) { const result = await parsed(child); if (result) candidates.push(result); }
        }
      }
      const changes = [...new Set(events.filter((event) => event.status === 'success').map((event) => event.fact?.change_id).filter(Boolean))];
      const change = changes.length === 1 ? changes[0] : null;
      if (Object.keys(issues).length) coverage.push('bundle_input_partial');
      const run = {
        schema: 1, collected_at: current.toISOString(), project_key: sha(String(project)), root_session: trace.id, turn,
        expectation: { mode: expectedMode, roles: [...new Set(expectedRoles)].sort(), source: 'operator_not_model' }, sessions, events,
        coverage: { status: coverage.length ? 'partial' : 'observed', issues: [...new Set(coverage)].sort() },
        snapshots: inventory, configuration_fingerprint: fingerprint, configuration_basis: 'current_inventory_not_proven_active',
        sdd: await sddArtifacts(project, change), host: { name: 'codex', native_trace: 'full' },
      };
      const report = diagnose(run);
      report.run_id = `run-${sha(legacyJson([String(project), id, turn])).slice(0, 20)}`;
      runs.push(report);
    } catch { issues.slice_collect_failed = (issues.slice_collect_failed ?? 0) + 1; }
  }
  if (Object.keys(issues).length) for (const run of runs) { run.coverage.status = 'partial'; run.coverage.issues = [...new Set([...run.coverage.issues, 'bundle_input_partial'])].sort(); }
  const selection = {
    days, limit, eligible_slices: slices.length, selected_slices: selected.length, exported_slices: runs.length,
    omitted_older_slices: omitted, issues: Object.fromEntries(Object.entries(issues).sort(([a], [b]) => a.localeCompare(b))),
    scope: 'recent_project_root_turns_not_a_single_task', sessions_scope: 'sessions_directory_only',
    expected_mode: expectedMode, expected_roles: [...new Set(expectedRoles)].sort(),
  };
  return [runs, inventory, selection];
}

export function encode(data) { return `${legacyJson(data, { ensureAscii: false, indent: 2 })}\n`; }

async function ensureDirectory(directory) {
  const absolute = path.resolve(directory);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError('symlink_path_refused');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(cursor, { mode: 0o700 });
      await chmod(cursor, 0o700).catch((chmodError) => { if (chmodError?.code !== 'EPERM') throw chmodError; });
    }
  }
  return absolute;
}

async function inGitTree(directory) {
  for (let cursor = path.resolve(directory); ; cursor = path.dirname(cursor)) {
    try { await lstat(path.join(cursor, '.git')); return true; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) return false;
  }
}

async function syncDirectory(directory) {
  let handle;
  try { handle = await open(directory, constants.O_RDONLY); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF', 'EPERM'].includes(error?.code)) throw error; }
  finally { await handle?.close(); }
}

export async function writeBundle(project, home, runs, inventory, selection, output = null, { now = new Date() } = {}) {
  const current = parseNow(now);
  const status = !runs.length ? 'no_sessions' : Object.keys(selection.issues ?? {}).length || selection.omitted_older_slices || runs.some((run) => run.coverage.status !== 'observed') ? 'partial' : 'ready';
  const defaultDirectory = path.join(home, 'sdd-observe', 'bundles');
  const fileName = `sdd-diagnose-${current.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '').replace('Z', 'Z')}-${randomBytes(4).toString('hex')}.zip`;
  const target = path.resolve(output ?? path.join(defaultDirectory, fileName));
  await safePath(target);
  if (path.extname(target).toLowerCase() !== '.zip') throw new TypeError('output_must_be_new_zip');
  try { await lstat(target); throw new TypeError('output_must_be_new_zip'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (await pathIsInside(target, project) || await inGitTree(path.dirname(target))) throw new TypeError('keep_bundle_outside_project_and_git');
  await ensureDirectory(path.dirname(target));
  const files = new Map([
    ['summary.md', Buffer.from(`# 诊断数据包\n\n状态：${status}。收集 ${runs.length} 个执行片段；未自动合并为同一个需求。\n\n数据范围见 manifest.json；无记录或覆盖不足不表示流程正确或错误。\n\n${runs.length ? summary(runs) : '未找到可用执行片段。请在发生问题的项目内调用技能，并确认本地保留了 Codex sessions。\n'}`, 'utf8')],
    ['inventory.json', Buffer.from(encode(inventory), 'utf8')],
    ['README.md', Buffer.from('# 诊断包说明\n\n先看 summary.md，再看 reports/ 中的逐片段报告。\n\n此包仅含既有离线观测器筛选的元数据、固定规则结论与指纹；不复制原始对话、思维链、命令、工具输出、源码、配置正文或凭据。仍含执行时间和关联 ID，请按需私下分享，不会自动上传。\n\ninventory.json 是采集时快照，不证明历史规则加载或模型动机。unknown 不是失败；未提供期望模式/角色时，不猜测是否应使用 SDD/Explorer。多个片段未推测为同一任务；报告可有进行中的片段。\n\nmanifest.json 列出范围、缺失项和每个文件的 SHA-256。导出与检查不调用模型、网络、Codex 或子进程。\n', 'utf8')],
  ]);
  runs.forEach((run, index) => {
    const name = String(index + 1).padStart(3, '0');
    files.set(`reports/${name}.md`, Buffer.from(markdown(run), 'utf8'));
    files.set(`data/${name}.json`, Buffer.from(encode(run), 'utf8'));
  });
  const total = [...files.values()].reduce((sum, file) => sum + file.length, 0);
  if (total > MAX_OUTPUT) throw new RangeError('bundle_size_limit_reduce_limit');
  const hashes = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, sha(data)]));
  const manifest = { schema: VERSION, created_at: current.toISOString(), status, diagnostic_model_calls: 0, project_key: sha(String(project)), selection, files: hashes };
  files.set('manifest.json', Buffer.from(encode(manifest), 'utf8'));
  const zip = new JSZip();
  for (const [name, data] of [...files].sort(([a], [b]) => a.localeCompare(b))) zip.file(name, data, { binary: true, date: current, unixPermissions: 0o100600 });
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'UNIX' });
  const temp = path.join(path.dirname(target), `.sdd-bundle-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = null;
    await link(temp, target);
    await syncDirectory(path.dirname(target));
  } finally {
    await handle?.close();
    await unlink(temp).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
  return { bundle: target, status, runs: runs.length, diagnostic_model_calls: 0 };
}

async function pathIsInside(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function runBundle(options) {
  const { project, home, sessionsDirectory, rulesRoot, days, limit, expectedMode, expectedRoles, output, now, skillFile } = options;
  const [runs, inventory, selection] = await collectRecent(project, home, sessionsDirectory, rulesRoot, days, limit, expectedMode, expectedRoles, { now, skillFile });
  return writeBundle(project, home, runs, inventory, selection, output, { now });
}
