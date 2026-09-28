import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collect, collectHostSnapshot, sddArtifacts } from '../../../lib/observation/collect.js';
import { diagnose } from '../../../lib/observation/diagnose.js';
import { baseRows, endRow, envelope, writeRows } from './helpers.js';

async function setup(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-collect-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project'), rules = path.join(temp, 'rules'), sessions = path.join(temp, 'sessions');
  await Promise.all([mkdir(project), mkdir(rules), mkdir(sessions)]);
  return { temp, project, rules, sessions };
}

test('collect scopes one turn, follows confirmed child only, and keeps unknown usage unknown', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const root = path.join(sessions, 'root.jsonl'), child = path.join(sessions, 'child.jsonl');
  await writeRows(root, [
    ...baseRows('root'),
    envelope('response_item', { type: 'function_call', call_id: 'spawn', name: 'spawn_agent', namespace: 'agents', arguments: JSON.stringify({ agent_type: 'worker' }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: 'child' }) }, 4),
    endRow(),
  ]);
  await writeRows(child, [
    ...baseRows('child', { parent_thread_id: 'root', agent_role: 'worker' }), endRow(30),
  ]);
  const run = await collect(project, rules, root, sessions, null, null, 'sdd', ['worker']);
  assert.deepEqual(run.sessions.map((session) => session.id), ['root', 'child']);
  assert.equal(run.sessions[1].role, 'worker');
  assert.equal(run.coverage.status, 'observed');
  assert.equal(diagnose(run).metrics.diagnostic_model_calls, 0);
});

test('multi-turn input must be scoped explicitly and artifact-only hosts never claim trace coverage', async (t) => {
  const { project, rules, sessions } = await setup(t);
  const file = path.join(sessions, 'multi.jsonl');
  const rows = [...baseRows(), endRow(10), envelope('event_msg', { type: 'task_started', turn_id: 'turn-2' }, 20, 'turn-2'), endRow(40)];
  await writeRows(file, rows);
  await assert.rejects(collect(project, rules, file), /multiple turns/);
  const host = await collectHostSnapshot(project, rules, 'opencode');
  assert.equal(host.host.native_trace, 'unsupported');
  assert.equal(host.coverage.status, 'partial');
  assert.ok(host.coverage.issues.includes('opencode_native_trace_unsupported'));
});

test('explicit Change history is projected without prose and validates graph shape', async (t) => {
  const { project } = await setup(t);
  const id = 'CHG-20260928-observation';
  const base = path.join(project, 'docs/05-changes/C01-进行中', id);
  const tasks = path.join(base, 'C03-tasks');
  await mkdir(tasks, { recursive: true });
  await writeFile(path.join(base, 'index.md'), `---\nid: ${id}\nstatus: running\ncontract: C01-change.md\ngraph: C03-tasks/C03-task-graph.json\n---\n`);
  await writeFile(path.join(base, 'C01-change.md'), 'synthetic private design details');
  await writeFile(path.join(tasks, 'C03-task-graph.json'), JSON.stringify({ tasks: [{ id: 'C03-01', state: 'accepted', attempt: 1, history: [{ state: 'submitted', attempt: 1 }, { state: 'accepted', attempt: 1 }] }] }));
  const result = await sddArtifacts(project, id);
  assert.equal(result.tasks[0].state, 'accepted');
  assert.equal(result.events[0].at, null);
  assert.equal(JSON.stringify(result).includes('synthetic private'), false);
  await writeFile(path.join(tasks, 'C03-task-graph.json'), JSON.stringify({ tasks: [null] }));
  await assert.rejects(sddArtifacts(project, id), /Invalid task object/);
});
