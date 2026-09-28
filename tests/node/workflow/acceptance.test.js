import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { graphSchema } from '../../../lib/runtime/graph-schema.js';
import { context, contractDigest, document, writeSpec } from '../../../lib/workflow/contract.js';
import { importDelivery, accept } from '../../../lib/workflow/lifecycle.js';
import { taskAcRefs } from '../../../lib/workflow/evidence.js';
import { CHANGE_ID, TASK_ID, commit, makeRepo } from './support.js';

function deliveryBody(taskContract, filename, { conclusion = '通过', failedAc = null, unverified = '无' } = {}) {
  const rows = taskAcRefs(taskContract).map((id) => `| \`${id}\` | Isolated delivery / acceptance path | ${id === failedAc ? '失败' : '通过'} | Node 24.21.0 assertion in an isolated Git fixture |`);
  return `## 文件改动\n\n> **交付结果**：Verified assigned-revision delivery through Main import and explicit acceptance.\n\n| 文件 | 操作 | 行为影响 |\n| --- | --- | --- |\n| \`${filename}\` | A | Adds the committed task-owned fixture used to verify delivery acceptance. |\n\n## 验证结果\n\n- **结论**：${conclusion}\n\n| AC / 场景 | 检查 | 结果 | 证据 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 自审结论\n\n- **已修复问题**：The isolated delivery report is bound to the assigned revision and contract.\n- **契约偏差**：无\n\n## 剩余问题\n\n- **未验证项**：${unverified}\n- **剩余风险**：Main must still perform project-level integration validation.\n\n## 快照影响\n\n- **范围**：technology\n- **说明**：The fixture changes no Current Truth snapshot.\n`;
}

function submittedWorkspace(t, options = {}) {
  const project = makeRepo(t);
  const filename = 'lib/workflow/acceptance-fixture.js';
  mkdirSync(path.join(project.root, 'lib/workflow'), { recursive: true });
  writeFileSync(path.join(project.root, filename), 'export const acceptanceFixture = true;\n');
  const resultRevision = commit(project.root, 'task result fixture');

  const c = context(project.root, CHANGE_ID, TASK_ID);
  c.task.state = 'running';
  c.task.history = [{ state: 'running', baseline: project.base, workspace: project.root, attempt: 1 }];
  c.task.baseline = project.base;
  c.task.workspace = project.root;
  c.task.attempt = 1;
  c.task.contract_digest = contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields);
  graphSchema.save(c.graphPath, c.graph);

  const report = document(project.root, c.directory, c.taskFields, 'report');
  const reportBody = deliveryBody(c.taskContractText ?? readFileSync(path.join(c.directory, c.taskFields.contract), 'utf8'), filename, options);
  writeSpec(report, {
    status: 'submitted', revision: resultRevision, attempt: '1',
    contract_digest: c.task.contract_digest, baseline: project.base,
  }, `\n${reportBody}`);
  return { ...project, report, resultRevision };
}

test('Main imports the assigned report, submits it, then explicitly accepts its bound revision', async (t) => {
  const project = submittedWorkspace(t);

  assert.equal(await importDelivery(project.root, CHANGE_ID, TASK_ID, project.root), 'submitted');
  const submitted = context(project.root, CHANGE_ID, TASK_ID).task;
  assert.equal(submitted.result_revision, project.resultRevision);
  assert.equal(submitted.state, 'submitted');

  assert.equal(await accept(project.root, CHANGE_ID, TASK_ID, 'accept', 'Reviewed all AC evidence against the delivered revision.'), 'accepted');
  const accepted = context(project.root, CHANGE_ID, TASK_ID).task;
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.result_revision, project.resultRevision);
  assert.equal(accepted.history.at(-1).reason, 'Reviewed all AC evidence against the delivered revision.');
});

test('acceptance rejects a submitted Delivery that has failed AC and unresolved work', async (t) => {
  const project = submittedWorkspace(t, { conclusion: '部分通过', failedAc: 'AC-03', unverified: 'The failed AC still needs correction.' });
  await importDelivery(project.root, CHANGE_ID, TASK_ID, project.root);

  await assert.rejects(
    accept(project.root, CHANGE_ID, TASK_ID, 'accept', 'Attempted acceptance must be mechanically blocked.'),
    /Delivery is not acceptance-ready:.*AC-03=失败.*未验证项/u,
  );
  assert.equal(context(project.root, CHANGE_ID, TASK_ID).task.state, 'submitted');
});
