import { lstat, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { legacyJson, parseLosslessJson } from '../runtime/compat-json.js';
import { digest, identifier, instant, policySignal, readRollout, ROLES, SKILLS, MAX_LINE } from './trace.js';

const MAX_FILE = 8 * 1024 * 1024;
const STATES = new Set(['planned', 'running', 'submitted', 'accepted', 'blocked']);
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const intValue = (value) => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (value && /^\d+$/u.test(value.toString())) { const parsed = Number(value.toString()); return Number.isSafeInteger(parsed) ? parsed : null; }
  return null;
};

async function noSymlinkPath(file) {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new TypeError('Symlink observation input refused'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return absolute;
}

export async function fileText(file, limit = MAX_FILE) {
  const absolute = await noSymlinkPath(file);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.size > limit) throw new TypeError('Expected a bounded, regular non-symlink input file');
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(absolute));
}

export function frontmatter(text) {
  if (!text.startsWith('---\n')) return {};
  const fields = Object.create(null);
  for (const line of text.slice(4).split('\n')) {
    if (line === '---') return fields;
    const colon = line.indexOf(':');
    if (colon < 0) throw new TypeError('Invalid SDD frontmatter');
    const key = line.slice(0, colon).trim();
    if (Object.hasOwn(fields, key)) throw new TypeError('Invalid SDD frontmatter');
    fields[key] = line.slice(colon + 1).trim();
  }
  throw new TypeError('Unclosed SDD frontmatter');
}

function safeChild(parent, name) {
  if (typeof name !== 'string' || path.basename(name) !== name || ['.', '..'].includes(name) || name.includes('\\')) throw new TypeError('Invalid SDD direct-child mapping');
  return path.join(parent, name);
}

function safeRelative(parent, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || path.isAbsolute(name)) throw new TypeError('Invalid SDD relative mapping');
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new TypeError('Invalid SDD relative mapping');
  return path.join(parent, ...parts);
}

async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }

export async function snapshot(project, rulesRoot, host = 'codex') {
  if (!['codex', 'opencode', 'claude'].includes(host)) throw new TypeError('Unknown observation host');
  const items = [];
  const files = [];
  const ruleNames = host === 'claude' ? ['CLAUDE.md'] : ['AGENTS.md', 'AGENTS.override.md'];
  for (const [label, directory] of [['rules', rulesRoot], ['project', project]]) {
    for (const name of ruleNames) {
      const file = path.join(directory, name);
      if (await exists(file)) files.push([`${label}/${name}`, file]);
    }
  }
  const suffix = host === 'codex' ? '.toml' : '.md';
  for (const role of [...ROLES].filter((value) => value !== 'main').sort()) files.push([`rules/agents/${role}${suffix}`, path.join(rulesRoot, 'agents', `${role}${suffix}`)]);
  const bases = [[path.join(rulesRoot, 'skills'), 'rules/skills'], [rulesRoot, 'source'], [path.join(project, '.agents', 'skills'), 'project/.agents/skills']];
  for (const [base, label] of bases) {
    for (const skill of [...SKILLS].sort()) {
      const skillFile = path.join(base, skill, 'SKILL.md');
      if (await exists(skillFile) || (label === 'rules/skills' && !await exists(path.join(rulesRoot, skill, 'SKILL.md')))) files.push([`${label}/${skill}/SKILL.md`, skillFile]);
      const references = path.join(base, skill, 'references');
      try {
        const refStat = await lstat(references);
        if (refStat.isDirectory() && !refStat.isSymbolicLink()) {
          for (const entry of (await readdir(references, { withFileTypes: true })).filter((item) => item.isFile() && item.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))) {
            files.push([`${label}/${skill}/references/${entry.name}`, path.join(references, entry.name)]);
          }
        }
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
  }
  for (const [label, file] of files) {
    const item = { path: label, evidence: 'current_inventory_not_runtime', status: 'missing' };
    try {
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) item.status = 'symlink_not_read';
      else if (stat.isFile()) {
        const text = await fileText(file);
        item.status = 'present';
        item.digest = digest(text);
        item.instruction_digest = digest(text.trim());
        item.bytes = Buffer.byteLength(text, 'utf8');
        if (['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'].includes(path.basename(file))) item.policy = policySignal(text);
        else if (file.endsWith('.toml')) {
          const role = parseToml(text, { integersAsBigInt: 'asNeeded' });
          item.model = identifier(role.model);
          item.effort = identifier(role.model_reasoning_effort);
          item.prompt_digest = typeof role.developer_instructions === 'string' ? digest(role.developer_instructions) : null;
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') item.status = 'unreadable';
    }
    items.push(item);
  }
  return items;
}

export async function sddArtifacts(project, changeId) {
  if (!changeId) return { association: 'unknown', tasks: [], events: [] };
  if (!/^CHG-\d{8}-[A-Za-z0-9_-]{1,80}$/u.test(changeId)) throw new TypeError('Use an English CHG-YYYYMMDD-slug identifier');
  const locations = ['C01-进行中', 'C02-已完成'].map((area) => path.join(project, 'docs', '05-changes', area, changeId));
  const found = [];
  for (const location of locations) if (await exists(location)) found.push(location);
  if (found.length > 1) throw new TypeError('Ambiguous active/completed Change');
  if (!found.length) return { association: 'explicit', change_id: changeId, status: 'not_found', tasks: [], events: [] };
  const directory = await noSymlinkPath(found[0]);
  const indexText = await fileText(path.join(directory, 'index.md'));
  const fields = frontmatter(indexText);
  if (fields.id !== changeId) throw new TypeError('Change identity mismatch');
  const result = { association: 'explicit', change_id: changeId, status: fields.status, index_digest: digest(indexText), tasks: [], events: [] };
  const contract = await fileText(safeChild(directory, fields.contract));
  result.contract_digest = digest(contract);
  result.source = `change:${changeId}`;
  if (!Object.hasOwn(fields, 'graph')) { result.graph = 'absent'; return result; }
  const graphText = await fileText(safeRelative(directory, fields.graph));
  const graph = parseLosslessJson(graphText);
  if (!isObject(graph) || !Array.isArray(graph.tasks)) throw new TypeError('Task graph must have a tasks array');
  result.graph = 'present';
  const known = new Set();
  for (const task of graph.tasks) {
    if (!isObject(task)) throw new TypeError('Invalid task object');
    const key = identifier(task.id);
    if (!key || known.has(key) || !STATES.has(task.state)) throw new TypeError('Invalid task identity/state');
    known.add(key);
    const attempt = task.attempt == null ? null : intValue(task.attempt);
    if (task.attempt != null && attempt == null) throw new TypeError('Invalid task attempt');
    const current = { id: key, state: task.state, attempt, contract_digest: identifier(task.contract_digest), baseline: identifier(task.baseline), result_revision: identifier(task.result_revision) };
    const history = task.history ?? [];
    if (!Array.isArray(history)) throw new TypeError('Invalid history');
    for (let n = 0; n < history.length; n += 1) {
      const event = history[n];
      if (!isObject(event) || !STATES.has(event.state)) throw new TypeError('Invalid history entry/state');
      const action = ['rework', 'replan', 'block'].includes(event.action) ? event.action : null;
      result.events.push({ kind: 'sdd.history', state: event.state, action, at: instant(event.timestamp), change_id: changeId, task_id: key,
        attempt: intValue(event.attempt), source: result.source, line: n + 1, locator: `tasks/${key}/history/${n}`,
        direct: ['rework', 'replan'].includes(action) ? event.invalidated_by === key : null });
    }
    result.tasks.push(current);
  }
  return result;
}

export function select(rootTrace, traces, turn) {
  const rootId = rootTrace.id;
  const turns = rootTrace.turns;
  if (!turn && turns.length > 1) throw new TypeError('Root session contains multiple turns; select --turn to avoid conflating separate user tasks');
  const selectedTurn = turn || turns[0] || null;
  if (turn && !turns.includes(turn) && !rootTrace.events.some((event) => event.turn === turn)) throw new TypeError('Requested turn not found in root rollout');
  const rootEvents = rootTrace.events.filter((event) => event.turn === selectedTurn || event.turn === null).map((event) => ({ ...event, session: rootId }));
  const start = rootEvents.find((event) => event.kind === 'turn.start')?.at ?? null;
  const end = [...rootEvents].reverse().find((event) => event.kind === 'turn.end')?.at ?? null;
  const events = [...rootEvents];
  const sessions = [];
  const issues = [...rootTrace.issues];
  const selected = new Map([[rootId, rootTrace]]);
  const roleByChild = new Map();
  while (true) {
    const expected = new Map();
    for (const event of events) {
      const fact = event.fact ?? {};
      if (['agent.spawn', 'agent.resume', 'agent.message'].includes(fact.kind) && event.status === 'success' && fact.child) expected.set(fact.child, fact.role);
    }
    const resumed = new Set(events.filter((event) => ['agent.resume', 'agent.message'].includes(event.fact?.kind) && event.status === 'success').map((event) => event.fact.child).filter(Boolean));
    for (const [key, role] of expected) if (role) roleByChild.set(key, role);
    let added = false;
    for (const candidate of traces) {
      if (!expected.has(candidate.id) || selected.has(candidate.id)) continue;
      if (!resumed.has(candidate.id) && candidate.parent && !selected.has(candidate.parent)) { issues.push('conflicting_parent'); continue; }
      selected.set(candidate.id, candidate);
      issues.push(...candidate.issues);
      let childEvents = candidate.events;
      if (start && end) childEvents = childEvents.filter((event) => event.at && event.at >= start && event.at <= end);
      else { issues.push('child_time_scope_unknown'); childEvents = []; }
      events.push(...childEvents.map((event) => ({ ...event, session: candidate.id })));
      added = true;
    }
    if (!added) {
      for (const child of expected.keys()) if (!selected.has(child)) issues.push('child_rollout_missing');
      break;
    }
  }
  for (const [key, trace] of selected) {
    const sessionEvents = events.filter((event) => event.session === key);
    const samples = trace.events.filter((event) => event.kind === 'usage.total');
    const current = sessionEvents.filter((event) => event.kind === 'usage.total');
    const before = samples.filter((event) => start && event.at && event.at < start);
    let usage = null;
    if (current.length) {
      let base = before.at(-1)?.usage ?? null;
      if (!base && key === rootId && !trace.parent && !trace.forked && selectedTurn === (turns[0] ?? null)) base = Object.fromEntries(Object.keys(current.at(-1).usage).map((field) => [field, 0n]));
      const latest = current.at(-1).usage;
      if (base && Object.keys(latest).every((field) => Object.hasOwn(base, field))) {
        const delta = Object.fromEntries(Object.entries(latest).map(([field, value]) => [field, BigInt(value) - BigInt(base[field])]));
        if (Object.values(delta).every((value) => value >= 0n)) usage = delta;
        else issues.push('usage_counter_reset');
      }
    }
    const contexts = sessionEvents.filter((event) => event.kind === 'context');
    sessions.push({ id: key, source: trace.source, source_digest: trace.source_digest, parent: trace.parent,
      role: key === rootId ? 'main' : roleByChild.get(key) || trace.role, version: trace.version, usage,
      model: contexts.at(-1)?.model ?? null, effort: contexts.at(-1)?.effort ?? null,
      policies: trace.policy.filter((policy) => policy.turn === null || policy.turn === selectedTurn || key !== rootId) });
  }
  for (const event of events) {
    if (event.fact?.kind === 'opaque') issues.push('opaque_tool_execution');
    if (event.kind === 'tool' && event.status === 'unknown') issues.push('tool_result_unknown');
  }
  if (!rootEvents.some((event) => event.kind === 'turn.start')) issues.push('turn_start_missing');
  if (!rootEvents.some((event) => event.kind === 'turn.end')) issues.push('turn_end_missing');
  return [sessions, events, [...new Set(issues)].sort()];
}

async function listJsonl(directory, onSymlink = () => {}) {
  const result = [];
  const walk = async (folder) => {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) { onSymlink(file); continue; }
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(file);
    }
  };
  await walk(directory);
  return result;
}

async function readHeader(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError('Invalid session header file');
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_LINE + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    const end = newline < 0 ? bytesRead : newline;
    if (end > MAX_LINE) throw new RangeError('Session header exceeds limit');
    return parseLosslessJson(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, end)));
  } finally { await handle.close(); }
}

export async function collect(project, rulesRoot, sessionFile, sessionsDir = null, turn = null, change = null, expectedMode = 'unknown', expectedRoles = []) {
  const rootTrace = await readRollout(sessionFile);
  const candidates = [];
  let scanErrors = 0;
  if (sessionsDir) {
    const safeSessionsDir = await noSymlinkPath(sessionsDir);
    const sessionsStat = await lstat(safeSessionsDir);
    if (sessionsStat.isSymbolicLink() || !sessionsStat.isDirectory()) throw new TypeError('Sessions directory must be a real directory');
    const indexed = new Map();
    for (const file of (await listJsonl(safeSessionsDir)).filter((candidate) => path.resolve(candidate) !== path.resolve(sessionFile))) {
      try {
        const row = await readHeader(file);
        if (row?.type !== 'session_meta') continue;
        const key = identifier(row.payload?.id);
        if (!key) continue;
        if (indexed.has(key)) scanErrors += 1;
        else indexed.set(key, file);
      } catch { scanErrors += 1; }
    }
    if (!turn && rootTrace.turns.length > 1) throw new TypeError('Root session contains multiple turns; select --turn to avoid conflating separate user tasks');
    const chosen = turn || rootTrace.turns[0] || null;
    const queue = [{ ...rootTrace, events: rootTrace.events.filter((event) => event.turn === chosen || event.turn === null) }];
    const visited = new Set([rootTrace.id]);
    while (queue.length) {
      const trace = queue.shift();
      for (const event of trace.events) {
        const child = event.fact?.child;
        if (!child || visited.has(child) || !indexed.has(child)) continue;
        visited.add(child);
        try { const parsed = await readRollout(indexed.get(child)); candidates.push(parsed); queue.push(parsed); }
        catch { scanErrors += 1; }
      }
    }
  }
  const [sessions, events, issues] = select(rootTrace, candidates, turn);
  if (scanErrors) issues.push('session_index_partial');
  if (!change) {
    const ids = [...new Set(events.filter((event) => event.status === 'success').map((event) => event.fact?.change_id).filter(Boolean))];
    change = ids.length === 1 ? ids[0] : null;
  }
  const artifacts = await sddArtifacts(project, change);
  const snapshots = await snapshot(project, rulesRoot, 'codex');
  const fingerprint = digest(legacyJson(snapshots.map((item) => [item.path, item.digest ?? null]), { sortKeys: true }));
  return {
    schema: 1, collected_at: new Date().toISOString(), host: { name: 'codex', native_trace: 'full' },
    project_key: digest(path.resolve(project)), root_session: rootTrace.id,
    turn: turn || (rootTrace.turns.length === 1 ? rootTrace.turns[0] : null),
    expectation: { mode: expectedMode, roles: [...new Set(expectedRoles)].sort(), source: 'operator_not_model' },
    sessions, events, coverage: { status: issues.length ? 'partial' : 'observed', issues: [...new Set(issues)].sort() },
    snapshots, configuration_fingerprint: fingerprint, configuration_basis: 'current_inventory_not_proven_active', sdd: artifacts,
  };
}

export async function collectHostSnapshot(project, rulesRoot, host, change = null, expectedMode = 'unknown', expectedRoles = []) {
  if (!['opencode', 'claude'].includes(host)) throw new TypeError('Artifact-only collection is for opencode/claude');
  const snapshots = await snapshot(project, rulesRoot, host);
  return {
    schema: 1, collected_at: new Date().toISOString(), host: { name: host, native_trace: 'unsupported' },
    project_key: digest(path.resolve(project)), root_session: `${host}:unobserved`, turn: null,
    expectation: { mode: expectedMode, roles: [...new Set(expectedRoles)].sort(), source: 'operator_not_model' },
    sessions: [], events: [], coverage: { status: 'partial', issues: [`${host}_native_trace_unsupported`] }, snapshots,
    configuration_fingerprint: digest(legacyJson(snapshots.map((item) => [item.path, item.digest ?? null]), { sortKeys: true })),
    configuration_basis: 'current_inventory_not_proven_active', sdd: await sddArtifacts(project, change),
  };
}

async function pathWithin(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function scanRuns(project, rulesRoot, sessionsDir, since = null, maxRuns = 100) {
  const safeSessionsDir = await noSymlinkPath(sessionsDir);
  const sessionsStat = await lstat(safeSessionsDir);
  if (sessionsStat.isSymbolicLink() || !sessionsStat.isDirectory()) throw new TypeError('Sessions directory must be a real directory');
  if (since && !/^\d{4}-\d{2}-\d{2}$/u.test(since)) throw new TypeError('--since requires YYYY-MM-DD (UTC)');
  if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new TypeError('--max-runs must be positive');
  const selected = [];
  let skipped = 0;
  const files = await listJsonl(safeSessionsDir, () => { skipped += 1; });
  for (const file of files) {
    try {
      const header = await readHeader(file);
      const meta = header?.payload;
      if (header?.type !== 'session_meta' || !isObject(meta)) continue;
      if (typeof meta.cwd !== 'string' || !path.isAbsolute(meta.cwd) || !await pathWithin(meta.cwd, project)) continue;
      if (meta.agent_role != null && typeof meta.agent_role !== 'string') throw new TypeError('Invalid agent role');
      const source = meta.source;
      if (meta.parent_thread_id || (typeof meta.agent_role === 'string' && ROLES.has(meta.agent_role) && meta.agent_role !== 'main') || (isObject(source) && Object.hasOwn(source, 'subagent'))) continue;
      const trace = await readRollout(file);
      for (const selectedTurn of trace.turns.length ? trace.turns : [null]) {
        const starts = trace.events.filter((event) => event.turn === selectedTurn && event.kind === 'turn.start' && event.at).map((event) => event.at);
        if (since && (!starts.length || starts[0].slice(0, 10) < since)) continue;
        selected.push({ file, id: trace.id, turn: selectedTurn });
      }
    } catch { skipped += 1; }
  }
  if (selected.length > maxRuns) throw new RangeError('Batch exceeds --max-runs; narrow --since or explicitly increase the bound');
  if (new Set(selected.map((item) => `${item.id}\u0000${item.turn ?? ''}`)).size !== selected.length) throw new TypeError('Duplicate root session/turn files; choose a single authoritative session directory');
  const results = [];
  for (const item of selected) {
    const run = await collect(project, rulesRoot, item.file, sessionsDir, item.turn);
    if (skipped) { run.coverage.issues.push('batch_index_partial'); run.coverage.status = 'partial'; }
    const runId = `run-${digest(legacyJson([path.resolve(project), item.id, item.turn])).slice(0, 20)}`;
    results.push([runId, run]);
  }
  return [results, skipped];
}
