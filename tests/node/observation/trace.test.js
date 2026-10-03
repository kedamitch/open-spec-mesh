import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commandFact, outputStatus, policySignal, readRollout } from '../../../lib/observation/trace.js';
import { baseRows, endRow, SECRET, writeRows, envelope } from './helpers.js';

test('trace reduces native calls and never retains raw arguments, output, cwd, or instructions', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-trace-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'rollout.jsonl');
  const rows = [
    ...baseRows('root', { cwd: '/private/project', base_instructions: SECRET }),
    envelope('response_item', { type: 'function_call', call_id: 'spawn-1', namespace: 'agents', name: 'agents.spawn_agent', arguments: JSON.stringify({ agent_type: 'explorer', prompt: SECRET, fork_turns: 'none' }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn-1', output: JSON.stringify({ agent_id: 'child-1', private: SECRET }) }, 4),
    envelope('response_item', { type: 'function_call', call_id: 'exec-1', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat /private/file' }) }, 5),
    envelope('response_item', { type: 'function_call_output', call_id: 'exec-1', output: JSON.stringify({ exit_code: 0, text: SECRET }) }, 6),
    endRow(),
  ];
  await writeRows(file, rows);
  const trace = await readRollout(file);
  assert.equal(trace.id, 'root');
  assert.equal(trace.events.find((event) => event.call_id === 'spawn-1').fact.kind, 'agent.spawn');
  assert.equal(trace.events.find((event) => event.call_id === 'spawn-1').status, 'success');
  assert.equal(trace.events.find((event) => event.call_id === 'exec-1').status, 'success');
  assert.equal(JSON.stringify(trace).includes(SECRET), false);
  assert.equal(JSON.stringify(trace).includes('/private/project'), false);
});

test('lossless cumulative usage and malformed lines remain distinguishable', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-trace-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'rollout.jsonl');
  const rows = [
    ...baseRows(),
    envelope('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 900719925474099312345n.toString(), output_tokens: 7 } } }, 3),
    { type: 'not-json', payload: 'ignored' },
    endRow(),
  ];
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\nnot-json\n`);
  const trace = await readRollout(file);
  assert.equal(trace.events.find((event) => event.kind === 'usage.total').usage.input_tokens, 900719925474099312345n);
  assert.ok(trace.issues.includes('invalid_or_partial_json'));
});

test('unsafe paths, command parsing, status, and policy parsing are conservative', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-trace-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const real = path.join(temp, 'real.jsonl');
  await writeRows(real, [...baseRows(), endRow()]);
  const link = path.join(temp, 'link.jsonl'); await symlink(real, link);
  await assert.rejects(readRollout(link), /non-symlink/);
  assert.equal(commandFact('python3 -c "import os"').kind, 'opaque');
  assert.equal(commandFact('python3 sdd-change/scripts/new_change.py x && echo y').kind, 'opaque');
  assert.equal(commandFact(['cat', '/x/.codex/skills/sdd-do/SKILL.md']).kind, 'skill.read');
  assert.deepEqual(outputStatus('{"exit_code":0}')[0], 'success');
  assert.equal(policySignal('| Explorer / Librarian | 已批准 Complex 需要独立证据 |'), 'explorer_requires_complex');
  assert.equal(policySignal('```md\n| Explorer / Librarian | 已批准 Complex |\n```'), null);
});


test('new stage skill reads are classified separately while historical sdd-change traces remain readable', () => {
  for (const skill of ['sdd-req', 'sdd-requirements', 'sdd-design', 'sdd-plan', 'sdd-change']) {
    assert.deepEqual(commandFact(['cat', '/installed/skills/' + skill + '/SKILL.md']), { kind: 'skill.read', skills: [skill] });
  }
});

test('current Node verification and document commands are classified without retaining arguments', () => {
  assert.deepEqual(commandFact('npm run validate:core'), { kind: 'verification.run', scope: 'integration', profile: 'core' });
  assert.deepEqual(commandFact('node --test tests/a.test.js'), { kind: 'verification.run', scope: 'targeted', profile: null });
  assert.equal(commandFact('node scripts/sdd_validate.js --profile full').kind, 'verification.run');
  assert.equal(commandFact('node bin/open-spec-mesh.js new-task CHG-20260930-test private-title --root /private').kind, 'task.create');
  assert.equal(commandFact('npm run validate:core && echo unsafe').kind, 'opaque');
});

test('native followup target aliases resolve the existing child without retaining messages', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-trace-alias-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'rollout.jsonl');
  await writeRows(file, [...baseRows(),
    envelope('response_item', { type: 'function_call', call_id: 'spawn', namespace: 'agents', name: 'spawn_agent', arguments: JSON.stringify({ task_name: 'explorer_known', agent_type: 'explorer', fork_turns: 'none', message: SECRET }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: 'child' }) }, 4),
    envelope('response_item', { type: 'function_call', call_id: 'follow', namespace: 'agents', name: 'followup_task', arguments: JSON.stringify({ target: '/root/explorer_known', message: SECRET }) }, 5),
    envelope('response_item', { type: 'function_call_output', call_id: 'follow', output: JSON.stringify({ status: 'queued' }) }, 6), endRow()]);
  const trace = await readRollout(file); const follow = trace.events.find(e => e.call_id === 'follow');
  assert.equal(follow.fact.kind, 'agent.resume'); assert.equal(follow.fact.child, 'child'); assert.equal(follow.status, 'success');
  assert.equal(JSON.stringify(trace).includes(SECRET), false);
});

test('V2 task-name-only spawn metadata resolves only against confirmed unique parent-role-alias headers', async (t) => {
  const { linkTaskAliases, sessionIdentity } = await import('../../../lib/observation/trace.js');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-v2-alias-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'root.jsonl');
  await writeRows(file, [...baseRows('root'),
    envelope('response_item', { type: 'function_call', call_id: 'spawn', namespace: 'agents', name: 'spawn_agent', arguments: JSON.stringify({ task_name: 'explorer_live_store', agent_type: 'explorer', fork_turns: 'none', message: SECRET }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ task_name: '/root/explorer_live_store', nickname: SECRET }) }, 4),
    envelope('response_item', { type: 'function_call', call_id: 'resume', namespace: 'agents', name: 'followup_task', arguments: JSON.stringify({ target: 'explorer_live_store', message: SECRET }) }, 5),
    endRow()]);
  const trace = await readRollout(file), events = trace.events.map(e => ({ ...e, session: 'root' }));
  const spawn = events.find(e => e.fact?.kind === 'agent.spawn');
  assert.equal(spawn.status, 'success'); assert.equal(spawn.fact.child, undefined);
  assert.equal(spawn.fact.child_alias, 'explorer_live_store');
  const header = sessionIdentity({ id: 'child', parent_thread_id: 'root', agent_role: 'explorer', agent_path: '/root/explorer_live_store', api_key: SECRET });
  const linked = linkTaskAliases(events, [header]);
  assert.equal(linked.events.find(e => e.fact?.kind === 'agent.spawn').fact.child, 'child');
  assert.equal(linked.events.find(e => e.fact?.kind === 'agent.resume').fact.child, 'child');
  assert.equal(JSON.stringify(linked).includes(SECRET), false);
  for (const headers of [[{ ...header, parent: 'other' }], [{ ...header, role: 'worker' }], [header, { ...header, id: 'another' }]]) {
    const rejected = linkTaskAliases(events, headers);
    assert.equal(rejected.events.find(e => e.fact?.kind === 'agent.spawn').fact.child, undefined);
  }
});

test('native V2 metadata and inter-agent messages are recognized without copying dialogue or double-counting usage', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-v2-meta-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'trace.jsonl');
  await writeRows(file, [...baseRows('root'),
    { type: 'world_state', payload: { private: SECRET } },
    { type: 'token_usage_record', payload: { input_tokens: 999, private: SECRET } },
    { type: 'inter_agent_communication_metadata', payload: { private: SECRET } },
    envelope('response_item', { type: 'agent_message', text: SECRET }, 3), endRow()]);
  const trace = await readRollout(file);
  assert.deepEqual(trace.issues, []);
  assert.equal(JSON.stringify(trace, (_, value) => typeof value === 'bigint' ? value.toString() : value).includes(SECRET), false);
  assert.equal(trace.events.filter(e => e.kind === 'usage.total').some(e => e.usage.input_tokens === 999n), false);
});
