import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commandFact, readRollout } from '../../../lib/observation/trace.js';
import { collect, scanRuns } from '../../../lib/observation/collect.js';
import { diagnose, groupRuns, summary } from '../../../lib/observation/diagnose.js';
import { StoreSession, withStore } from '../../../lib/observation/store.js';
import { baseRows, endRow, envelope, writeRows } from './helpers.js';

const fixture = (name) => new URL(`../../fixtures/migration/observation/${name}`, import.meta.url);
async function setup(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-compat-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project'), rules = path.join(temp, 'rules'), sessions = path.join(temp, 'sessions');
  await Promise.all([mkdir(project), mkdir(rules), mkdir(sessions)]);
  return { temp, project, rules, sessions };
}

test('native collab, wrapped exec, opaque execution, and unrelated MCP namespaces retain distinct evidence', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const file = path.join(sessions, 'root.jsonl');
  const rows = [
    ...baseRows(),
    envelope('response_item', { type: 'function_call', call_id: 'spawn', namespace: 'agents', name: 'spawn_agent', arguments: JSON.stringify({ agent_type: 'explorer' }) }, 3),
    envelope('event_msg', { type: 'collab_agent_spawn_end', call_id: 'spawn', new_thread_id: 'child', new_agent_role: 'explorer' }, 4),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: 'child' }) }, 5),
    envelope('response_item', { type: 'function_call', call_id: 'exec', name: 'exec', arguments: JSON.stringify({ command: 'opaque js' }) }, 6),
    envelope('event_msg', { type: 'exec_command_begin', call_id: 'exec', command: ['cat', '/skills/sdd-do/SKILL.md'] }, 7),
    envelope('event_msg', { type: 'exec_command_end', call_id: 'exec', exit_code: 0 }, 8),
    envelope('response_item', { type: 'function_call', call_id: 'mcp', name: 'mcp__server__spawn_agent', namespace: 'mcp__server', arguments: JSON.stringify({ agent_type: 'explorer' }) }, 9),
    envelope('response_item', { type: 'function_call_output', call_id: 'mcp', output: JSON.stringify({ agent_id: 'fake-child' }) }, 10),
    envelope('response_item', { type: 'function_call', call_id: 'opaque', name: 'exec', arguments: JSON.stringify({ input: 'tools.spawn_agent(...)' }) }, 11),
    envelope('response_item', { type: 'function_call_output', call_id: 'opaque', output: JSON.stringify({ exit_code: 0 }) }, 12),
    endRow(),
  ];
  await writeRows(file, rows);
  const trace = await readRollout(file);
  assert.equal(trace.events.filter((event) => event.fact?.kind === 'agent.spawn').length, 1);
  assert.equal(trace.events.filter((event) => event.fact?.kind === 'skill.read').length, 1);
  const run = diagnose(await collect(project, rules, file));
  assert.equal(run.metrics.spawn_attempts, 1);
  assert.equal(run.metrics.skill_read_commands, 1);
  assert.ok(run.coverage.issues.includes('opaque_tool_execution'));
});

test('turn scoping, prior cumulative usage, and reset counters preserve unknown boundaries', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const file = path.join(sessions, 'turns.jsonl');
  const usage = (tokens, second, turnId) => envelope('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: tokens, cached_input_tokens: 1, output_tokens: 2 } } }, second, turnId);
  await writeRows(file, [
    ...baseRows(), usage(100, 10, 'turn-1'), endRow(20),
    envelope('event_msg', { type: 'task_started', turn_id: 'turn-2' }, 21), usage(125, 30, 'turn-2'), endRow(50),
  ]);
  await assert.rejects(collect(project, rules, file), /multiple turns/);
  const selected = diagnose(await collect(project, rules, file, null, 'turn-2'));
  assert.equal(selected.turn, 'turn-2');
  assert.equal(selected.metrics.usage_observed.input_tokens, 25n);
  const resetFile = path.join(sessions, 'reset.jsonl');
  await writeRows(resetFile, [...baseRows('reset'), usage(100, 10, 'turn-1'), endRow(20), envelope('event_msg', { type: 'task_started', turn_id: 'turn-2' }, 21), usage(90, 30, 'turn-2'), endRow(50)]);
  const reset = await collect(project, rules, resetFile, null, 'turn-2');
  assert.ok(reset.coverage.issues.includes('usage_counter_reset'));
  assert.equal(diagnose(reset).sessions[0].usage, null);
});

test('diagnostics keep absence unknown, classify explicit restriction and positive failures, and summarize without causal claims', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const rulesText = '# Rules\n| Agent | Timing |\n| --- | --- |\n| Explorer / Librarian | 已批准 Complex 中调查 |\n';
  await (await import('node:fs/promises')).writeFile(path.join(rules, 'AGENTS.md'), rulesText);
  const file = path.join(sessions, 'root.jsonl');
  await writeRows(file, [
    ...baseRows('root', { developer_instructions: rulesText }),
    envelope('response_item', { type: 'function_call', call_id: 'spawn', name: 'spawn_agent', namespace: 'agents', arguments: JSON.stringify({ agent_type: 'worker' }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ error: 'synthetic failure' }) }, 4),
    endRow(),
  ]);
  const restricted = diagnose(await collect(project, rules, file, null, null, null, 'sdd', ['explorer']));
  assert.ok(restricted.findings.some((finding) => finding.rule === 'D01' && finding.category === 'observed_failure'));
  assert.ok(restricted.findings.some((finding) => finding.rule === 'D02' && finding.category === 'policy_restriction'));
  assert.equal(JSON.stringify(restricted).includes('synthetic failure'), false);
  const quick = diagnose(await collect(project, rules, file, null, null, null, 'quick', []));
  assert.equal(quick.findings.some((finding) => finding.rule === 'S01' || finding.rule === 'P01'), false);
  const aggregated = summary([{ ...quick, run_id: 'one' }, { ...quick, run_id: 'two' }]);
  assert.match(aggregated, /仅描述关联/);
  assert.match(aggregated, /0\/0/);
});

test('history without timestamps stays null; grouping rejects duplicate or cross-project slices', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const change = 'CHG-20260928-observation';
  const directory = path.join(project, 'docs/05-changes/C01-进行中', change);
  await mkdir(path.join(directory, 'C03-tasks'), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(directory, 'index.md'), `---\nid: ${change}\nstatus: running\ncontract: C01-change.md\ngraph: C03-tasks/C03-task-graph.json\n---\n`);
  await writeFile(path.join(directory, 'C01-change.md'), '# synthetic');
  await writeFile(path.join(directory, 'C03-tasks/C03-task-graph.json'), JSON.stringify({ tasks: [{ id: 'C03-01', state: 'accepted', attempt: 1, history: [{ state: 'submitted', attempt: 1 }, { state: 'accepted', attempt: 1 }] }] }));
  const rolloutA = path.join(sessions, 'a.jsonl'); await writeRows(rolloutA, [...baseRows('a'), endRow()]);
  const rolloutB = path.join(sessions, 'b.jsonl'); await writeRows(rolloutB, [...baseRows('b'), endRow()]);
  const a = { ...diagnose(await collect(project, rules, rolloutA, null, null, change)), run_id: 'a' };
  const b = { ...diagnose(await collect(project, rules, rolloutB, null, null, change)), run_id: 'b' };
  assert.equal(a.sdd.events[0].at, null);
  assert.throws(() => groupRuns([a, { ...a, run_id: 'duplicate' }]), /Overlapping/);
  assert.throws(() => groupRuns([a, { ...b, project_key: 'different-project' }]), /different projects/);
  const group = groupRuns([a, b]);
  assert.equal(group.members.length, 2);
  assert.equal(group.metrics.first_pass.denominator, 1);
});

test('scan splits turns, enforces bounds, and records malformed header omissions', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const multi = path.join(sessions, 'multi.jsonl');
  await writeRows(multi, [
    ...baseRows('root', { cwd: project }), endRow(10),
    envelope('event_msg', { type: 'task_started', turn_id: 'turn-2' }, 20), endRow(30),
  ]);
  await symlink(multi, path.join(sessions, 'multi-alias.jsonl'));
  const [runs, skipped] = await scanRuns(project, rules, sessions);
  assert.equal(skipped, 1);
  assert.equal(runs.length, 2);
  await assert.rejects(scanRuns(project, rules, sessions, null, 1), /exceeds --max-runs/);
  const bad = path.join(sessions, 'invalid.jsonl');
  await writeRows(bad, [...baseRows('invalid', { cwd: project, agent_role: ['bad'] }), endRow()]);
  const [after, omitted] = await scanRuns(project, rules, sessions);
  assert.equal(after.length, 2);
  assert.equal(omitted, 2);
});

test('migration fixtures with foreign ownership and unsupported schema remain byte-identical', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-compat-db-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  for (const name of ['foreign.sqlite3', 'unsupported-version.sqlite3']) {
    const target = path.join(temp, name); await copyFile(fixture(name), target); await chmod(target, 0o600);
    const before = await (await import('node:fs/promises')).readFile(target);
    await assert.rejects(withStore(target, () => {}, { create: false }), /unsupported|not an observation/);
    assert.deepEqual(await (await import('node:fs/promises')).readFile(target), before);
  }
});

test('failed export/publish after transaction commit keeps the prior SQLite bytes', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-compat-db-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const db = path.join(temp, 'store.sqlite3');
  const run = { project_key: 'p', root_session: 'r', turn: null, expectation: { mode: 'unknown', roles: [], source: 'operator_not_model' }, sdd: { association: 'unknown' }, collected_at: '2026-09-28T00:00:00Z', events: [], sessions: [], findings: [], metrics: {} };
  await withStore(db, (store) => store.save('first', run));
  const before = await (await import('node:fs/promises')).readFile(db);
  const original = StoreSession.prototype.publish;
  StoreSession.prototype.publish = function failPublish() { throw new Error('synthetic publish fault'); };
  try { await assert.rejects(withStore(db, (store) => store.save('second', { ...run, project_key: 'p2' })), /synthetic publish fault/); }
  finally { StoreSession.prototype.publish = original; }
  assert.deepEqual(await (await import('node:fs/promises')).readFile(db), before);
});

test('artifact inputs reject symlinked trace files and native unknown events disclose partial coverage', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const real = path.join(sessions, 'real.jsonl'); await writeRows(real, [...baseRows(), envelope('event_msg', { type: 'future_executor' }, 4), endRow()]);
  const linked = path.join(sessions, 'linked.jsonl'); await symlink(real, linked);
  await assert.rejects(readRollout(linked), /non-symlink/);
  const run = await collect(project, rules, real);
  assert.ok(run.coverage.issues.includes('unknown_event'));
});

test('legacy facade command observations distinguish prepare, draft delivery, wave preflight, and validation', () => {
  assert.equal(commandFact(['python3', '-B', '/installed/skills/sdd-change/scripts/sdd.py', 'prepare', 'CHG-20260928-test', '--task', 'C03-01']).kind, 'task.prepare');
  assert.equal(commandFact(['python3', '-B', '/installed/skills/sdd-change/scripts/sdd.py', 'deliver', '--draft', '--attempt', '1']).kind, 'task.delivery-draft');
  assert.equal(commandFact(['python3', '-B', '/installed/skills/sdd-change/scripts/sdd.py', 'integrate', '--wave', '--check']).kind, 'change.integrate-wave-preflight');
  assert.equal(commandFact(['python3', '-B', '/installed/skills/sdd-close/scripts/run_validation.py', 'CHG-20260928-test']).kind, 'change.validate');
  assert.equal(commandFact(['python3', '-B', '/installed/skills/sdd-change/scripts/sdd.py', 'close', '--accept', '--archive']).kind, 'change.close');
});
