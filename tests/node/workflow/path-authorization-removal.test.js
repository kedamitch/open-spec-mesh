import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { graphSchema } from '../../../lib/runtime/graph-schema.js';
import { context, contractDigest, document, readTextCompat } from '../../../lib/workflow/contract.js';
import { checkChange, closeChange } from '../../../lib/workflow/closure.js';
import { integrationCheck, integrate } from '../../../lib/workflow/integration.js';
import { accept, deliver, draftDelivery, importDelivery, prepare } from '../../../lib/workflow/lifecycle.js';
import { runValidation } from '../../../lib/workflow/receipt.js';
import { changedFiles, taskAcRefs } from '../../../lib/workflow/evidence.js';
import { CHANGE_ID, TASK_ID, commit, git, makeRepo, writeValidationConfig } from './support.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function deliveryBody(taskContract, files) {
  const fileRows = [...files].sort(([left], [right]) => left.localeCompare(right))
    .map(([filename, operation]) => `| \`${filename}\` | ${operation} | The committed change is recorded from the real Git diff. |`);
  const acRows = taskAcRefs(taskContract)
    .map((id) => `| \`${id}\` | Legacy-table lifecycle regression | 通过 | Node 24.21.0 isolated lifecycle assertions passed |`);
  return `## 文件改动\n\n> **交付结果**：The complete SDD workflow accepts a committed result without file-path authorization.\n\n| 文件 | 操作 | 行为影响 |\n| --- | --- | --- |\n${fileRows.join('\n')}\n\n## 验证结果\n\n- **结论**：通过\n\n| AC / 场景 | 检查 | 结果 | 证据 |\n| --- | --- | --- | --- |\n${acRows.join('\n')}\n\n## 自审结论\n\n- **已修复问题**：Path authorization no longer gates planning, draft, delivery, import, acceptance or integration.\n- **契约偏差**：无\n\n## 剩余问题\n\n- **未验证项**：无\n- **剩余风险**：Full repository validation remains Main's responsibility.\n\n## 快照影响\n\n- **范围**：technology\n- **说明**：No Current Truth snapshot is changed by this isolated fixture.\n`;
}

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length - 1, 1, `expected one occurrence of ${before}`);
  return text.replace(before, after);
}

test('conflicting legacy allow/deny rows do not block draft through Change closure', async (t) => {
  const project = makeRepo(t);
  const main = context(project.root, CHANGE_ID, TASK_ID);
  const upstream = main.graph.tasks.find((task) => task.id === 'C03-01');
  upstream.state = 'accepted';
  upstream.history = [{ state: 'accepted', reason: 'integrated prerequisite fixture', revision: project.base }];
  upstream.result_revision = project.base;
  upstream.baseline = project.base;
  upstream.attempt = 1;
  graphSchema.save(main.graphPath, main.graph);

  const taskContractPath = document(project.root, main.directory, main.taskFields, 'contract');
  const originalTaskContract = readFileSync(taskContractPath, 'utf8');
  const taskContract = originalTaskContract.replace(
    /^### Path Contract\n[\s\S]*?(?=^### 代码结构 \/ 模块落点$)/mu,
    '### Path Contract\n\n| 规则 | 路径 |\n| --- | --- |\n| allow | `**` |\n| deny | `docs/03-architecture/**` |\n\n',
  );
  assert.notEqual(taskContract, originalTaskContract);
  writeFileSync(taskContractPath, taskContract);

  const worker = path.join(project.parent, 'worker workspace');
  await prepare(project.root, CHANGE_ID, TASK_ID, { base: 'HEAD', worktree: worker });
  const workerContext = context(worker, CHANGE_ID, TASK_ID);
  const filename = 'docs/03-architecture/legacy-denied-output.txt';
  mkdirSync(path.dirname(path.join(worker, filename)), { recursive: true });
  writeFileSync(path.join(worker, filename), 'A legacy deny row must not block this committed result.\n');
  const resultRevision = commit(worker, 'add file denied by legacy Task table');
  const attempt = workerContext.task.attempt;
  const evidenceFile = path.join(project.parent, 'delivery-evidence.md');

  const draft = await draftDelivery(worker, CHANGE_ID, TASK_ID, resultRevision, attempt, evidenceFile);
  assert.equal(draft.status, 'draft');
  assert.match(readFileSync(evidenceFile, 'utf8'), new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  const workerTaskContract = readFileSync(document(worker, workerContext.directory, workerContext.taskFields, 'contract'), 'utf8');
  const files = changedFiles(worker, project.base, resultRevision);
  assert.equal(files.get(filename), 'A');
  writeFileSync(evidenceFile, deliveryBody(workerTaskContract, files));
  await deliver(worker, CHANGE_ID, TASK_ID, { result: resultRevision, attempt, evidenceFile });
  await importDelivery(project.root, CHANGE_ID, TASK_ID, worker);
  assert.equal(context(project.root, CHANGE_ID, TASK_ID).task.state, 'submitted');
  await accept(project.root, CHANGE_ID, TASK_ID, 'accept', 'verified legacy-table regression');
  assert.equal(context(project.root, CHANGE_ID, TASK_ID).task.state, 'accepted');

  assert.equal(integrationCheck(project.root, CHANGE_ID, TASK_ID).integration, 'ready');
  const integrated = await integrate(project.root, CHANGE_ID, TASK_ID);
  assert.equal(integrated.integration, 'integrated');
  assert.equal(readFileSync(path.join(project.root, filename), 'utf8'), 'A legacy deny row must not block this committed result.\n');

  // Other accepted Tasks are closure-fixture inputs; this test exercises the full lifecycle of C03-02.
  const closure = context(project.root, CHANGE_ID);
  const integratedRevision = git(project.root, 'rev-parse', 'HEAD');
  for (const task of closure.graph.tasks) {
    if (task.id !== TASK_ID) {
      task.state = 'accepted';
      task.history = [{ state: 'accepted', reason: 'isolated Change-closure fixture', revision: integratedRevision }];
      task.result_revision = integratedRevision;
      task.baseline = project.base;
      task.attempt = 1;
    }
  }
  graphSchema.save(closure.graphPath, closure.graph);
  for (const task of closure.graph.tasks) {
    const current = context(project.root, CHANGE_ID, task.id);
    task.contract_digest = contractDigest(project.root, current.change, current.fields, current.directory, current.taskFields);
    const report = document(project.root, current.directory, current.taskFields, 'report');
    task.report_digest = sha256(Buffer.from(readTextCompat(report), 'utf8'));
  }
  graphSchema.save(closure.graphPath, closure.graph);
  commit(project.root, 'complete isolated accepted graph for closure');

  const changeContract = document(project.root, closure.change, closure.fields, 'contract');
  let changeText = readFileSync(changeContract, 'utf8');
  changeText = replaceOnce(changeText, 'integrated_revision: pending', `integrated_revision: ${git(project.root, 'rev-parse', 'HEAD')}`);
  changeText = replaceOnce(changeText, 'product: pending', 'product: No product snapshot change in this workflow fixture.');
  changeText = replaceOnce(changeText, 'technology: pending', 'technology: Workflow path authorization is covered by isolated runtime tests.');
  changeText = replaceOnce(changeText, 'operations: pending', 'operations: No operations snapshot change in this workflow fixture.');
  changeText = changeText.replace(
    /<!-- SDD:EVIDENCE:BEGIN -->[\s\S]*?<!-- SDD:EVIDENCE:END -->/u,
    '<!-- SDD:EVIDENCE:BEGIN -->\n## 验证结果\n\nAC-03, AC-04 and AC-05 passed in the isolated workflow fixture.\n\n## 最终结论\n\npass\n<!-- SDD:EVIDENCE:END -->',
  );
  writeFileSync(changeContract, changeText);
  mkdirSync(path.join(project.root, 'scripts'), { recursive: true });
  writeFileSync(path.join(project.root, 'scripts/check.js'), 'process.stdout.write("fixture checks passed\\n");\n');
  writeValidationConfig(project.root, 'scripts/check.js');
  commit(project.root, 'commit validation entrypoint and Change evidence');
  const finalIntegratedRevision = git(project.root, 'rev-parse', 'HEAD');
  changeText = readFileSync(changeContract, 'utf8').replace(
    /(?<=^integrated_revision: ).+$/mu,
    finalIntegratedRevision,
  );
  writeFileSync(changeContract, changeText);

  const receipt = await runValidation(project.root, CHANGE_ID, finalIntegratedRevision);
  assert.equal(receipt.passed, true);
  assert.equal(checkChange(project.root, CHANGE_ID), finalIntegratedRevision);
  assert.equal(await closeChange(project.root, CHANGE_ID), path.join(project.root, 'docs/05-changes/C02-已完成', CHANGE_ID));
});
