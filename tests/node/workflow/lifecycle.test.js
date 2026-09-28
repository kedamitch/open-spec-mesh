import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LosslessNumber } from 'lossless-json';
import { test } from 'node:test';
import { graphSchema } from '../../../lib/runtime/graph-schema.js';
import { context, contractDigest } from '../../../lib/workflow/contract.js';
import { transition } from '../../../lib/workflow/transition.js';
import { prepareWorkspace } from '../../../lib/workflow/workspace.js';
import { taskAcRefs } from '../../../lib/workflow/evidence.js';
import { makeRepo, CHANGE_ID, TASK_ID } from './support.js';

function taskContract(project) {
  const c = context(project.root, CHANGE_ID, TASK_ID);
  return { ...c, text: readFileSync(path.join(c.directory, c.taskFields.contract), 'utf8') };
}

test('prepare increments lossless attempt values without IEEE-754 truncation', async (t) => {
  const project = makeRepo(t);
  const c = taskContract(project);
  const upstream = c.graph.tasks.find((item) => item.id === 'C03-01');
  upstream.state = 'accepted';
  upstream.result_revision = project.base;
  upstream.baseline = project.base;
  upstream.attempt = new LosslessNumber('1');

  c.task.state = 'planned';
  c.task.history = [];
  c.task.attempt = new LosslessNumber('9007199254740991');
  for (const key of ['result_revision', 'contract_digest', 'report_digest', 'workspace', 'baseline', 'agent_session']) delete c.task[key];
  graphSchema.save(c.graphPath, c.graph);
  c.task.contract_digest = contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields);
  graphSchema.save(c.graphPath, c.graph);

  const location = await prepareWorkspace(project.root, CHANGE_ID, TASK_ID, 'HEAD');
  assert.equal(location, project.root);
  const saved = graphSchema.load(c.graphPath).tasks.find((item) => item.id === TASK_ID);
  assert.equal(saved.state, 'running');
  assert.equal(saved.attempt.toString(), '9007199254740992');
});

test('rework preserves assigned attempt, workspace and exact session while clearing submission state', (t) => {
  const project = makeRepo(t);
  const c = taskContract(project);
  c.task.state = 'running';
  c.task.history = [{ state: 'running', attempt: 23 }];
  c.task.attempt = new LosslessNumber('9007199254740992');
  c.task.baseline = project.base;
  c.task.workspace = project.root;
  c.task.agent_session = 'session:exact/42';
  graphSchema.save(c.graphPath, c.graph);
  c.task.contract_digest = contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields);
  const frozenDigest = c.task.contract_digest;
  graphSchema.save(c.graphPath, c.graph);

  assert.equal(transition(project.root, CHANGE_ID, TASK_ID, 'rework', 'Targeted verification found a fixable defect.', { workersStopped: true }), 'planned');
  const saved = graphSchema.load(c.graphPath).tasks.find((item) => item.id === TASK_ID);
  assert.equal(saved.attempt.toString(), '9007199254740992');
  assert.equal(saved.workspace, project.root);
  assert.equal(saved.agent_session, 'session:exact/42');
  assert.equal(saved.baseline, undefined);
  assert.equal(saved.contract_digest, undefined);
  assert.equal(saved.history.at(-1).state, 'planned');
  const previous = saved.history.at(-1).previous;
  assert.equal(previous.state, 'running');
  assert.equal(previous.baseline, project.base);
  assert.equal(previous.workspace, project.root);
  assert.equal(previous.contract_digest, frozenDigest);
  assert.equal(previous.attempt.toString(), '9007199254740992');
  assert.equal(previous.agent_session, 'session:exact/42');
});

test('Task-local delivery AC references remain the exact frozen acceptance set', (t) => {
  const project = makeRepo(t);
  const { text } = taskContract(project);
  assert.deepEqual(taskAcRefs(text), ['AC-03', 'AC-04', 'AC-05']);
});
