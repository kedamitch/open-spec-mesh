import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { graphSchema } from '../../../lib/runtime/graph-schema.js';
import { context, contractDigest, document, readTextCompat, revision, writeSpec } from '../../../lib/workflow/contract.js';
import { integrationCheck, integrate } from '../../../lib/workflow/integration.js';
import { taskAcRefs } from '../../../lib/workflow/evidence.js';
import { CHANGE_ID, TASK_ID, commit, git, makeRepo } from './support.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function deliveryBody(taskContract, filename) {
  const rows = taskAcRefs(taskContract).map((id) => `| \`${id}\` | Isolated Git integration regression | 通过 | Node 24.21.0 assertions passed |`);
  return `## 文件改动\n\n> **交付结果**：Task result commit is bound to the reported revision.\n\n| 文件 | 操作 | 行为影响 |\n| --- | --- | --- |\n| \`${filename}\` | A | Adds one task-owned workflow module used by the isolated integration fixture. |\n\n## 验证结果\n\n- **结论**：通过\n\n| AC / 场景 | 检查 | 结果 | 证据 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 自审结论\n\n- **已修复问题**：Git ancestry and Change snapshot recovery are checked.\n- **契约偏差**：无\n\n## 剩余问题\n\n- **未验证项**：无\n- **剩余风险**：Full repository integration remains owned by Main.\n\n## 快照影响\n\n- **范围**：technology\n- **说明**：No Current Truth snapshot is changed by this test.\n`;
}

function makeAcceptedResult(t, { conflict }) {
  const project = makeRepo(t);
  const filename = 'lib/workflow/integration-fixture.js';
  const file = path.join(project.root, filename);
  mkdirSync(path.dirname(file), { recursive: true });

  git(project.root, 'checkout', '-b', 'task-result');
  writeFileSync(file, 'export const source = "task";\n');
  const resultRevision = commit(project.root, 'Task result');
  git(project.root, 'checkout', '--detach', project.base);

  let mainRevision = project.base;
  if (conflict) {
    git(project.root, 'checkout', '-b', 'main-conflict', project.base);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export const source = "main";\n');
    mainRevision = commit(project.root, 'Main conflicting edit');
  }

  const c = context(project.root, CHANGE_ID, TASK_ID);
  c.task.state = 'accepted';
  c.task.result_revision = resultRevision;
  c.task.baseline = project.base;
  c.task.attempt = 1;
  c.task.workspace = project.root;
  c.task.contract_digest = contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields);
  const reportBody = deliveryBody(readFileSync(document(project.root, c.directory, c.taskFields, 'contract'), 'utf8'), filename);
  const report = document(project.root, c.directory, c.taskFields, 'report');
  writeSpec(report, {
    status: 'submitted', revision: resultRevision, attempt: '1',
    contract_digest: c.task.contract_digest, baseline: project.base,
  }, `\n# Task Delivery\n\n${reportBody.trim()}\n`);
  c.task.report_digest = sha256(Buffer.from(readTextCompat(report), 'utf8'));
  graphSchema.save(c.graphPath, c.graph);
  chmodSync(report, 0o640);
  chmodSync(c.directory, 0o710);
  chmodSync(c.change, 0o750);
  return { ...project, filename, resultRevision, mainRevision, report, graphPath: c.graphPath };
}

function registeredWorktreePaths(root) {
  return git(root, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
}

test('accepted Task integration preserves result ancestry and byte/mode-stable active Change snapshots', async (t) => {
  const project = makeAcceptedResult(t, { conflict: false });
  const graphBefore = readFileSync(project.graphPath);
  const reportBefore = readFileSync(project.report);
  assert.equal(statSync(project.report).mode & 0o777, 0o640);

  const check = integrationCheck(project.root, CHANGE_ID, TASK_ID);
  assert.equal(check.integration, 'ready');
  assert.deepEqual(registeredWorktreePaths(project.root), [project.root]);

  const result = await integrate(project.root, CHANGE_ID, TASK_ID);
  assert.equal(result.integration, 'integrated');
  assert.equal(result.result_revision, project.resultRevision);
  assert.equal(git(project.root, 'merge-base', '--is-ancestor', project.resultRevision, 'HEAD') === '', true);
  assert.deepEqual(readFileSync(project.graphPath), graphBefore);
  assert.deepEqual(readFileSync(project.report), reportBefore);
  assert.equal(statSync(project.report).mode & 0o777, 0o640);
  assert.equal(statSync(path.dirname(project.report)).mode & 0o777, 0o710);
  assert.equal(statSync(project.change).mode & 0o777, 0o750);
  assert.deepEqual(registeredWorktreePaths(project.root), [project.root]);
});

test('external conflict returns without mutating Main HEAD, Graph, report, or registered worktrees', (t) => {
  const project = makeAcceptedResult(t, { conflict: true });
  const graphBefore = readFileSync(project.graphPath);
  const reportBefore = readFileSync(project.report);
  const headBefore = revision(project.root, 'HEAD');

  const result = integrationCheck(project.root, CHANGE_ID, TASK_ID);
  assert.equal(result.integration, 'conflict');
  assert.deepEqual(result.conflicts, [project.filename]);
  assert.equal(revision(project.root, 'HEAD'), headBefore);
  assert.deepEqual(readFileSync(project.graphPath), graphBefore);
  assert.deepEqual(readFileSync(project.report), reportBefore);
  assert.deepEqual(registeredWorktreePaths(project.root), [project.root]);
});
