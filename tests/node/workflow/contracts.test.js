import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { context, contractDigest } from '../../../lib/workflow/contract.js';
import { planningComplete } from '../../../lib/workflow/readiness.js';
import { structuredDelivery, taskAcRefs, validateEvidence } from '../../../lib/workflow/evidence.js';
import { commit, makeRepo, TASK_ID } from './support.js';

const goldenDigest = readFileSync(new URL('../../../tests/fixtures/migration/workflow/c03-02-contract-digest.txt', import.meta.url), 'utf8').trim();
const frozenDigest = readFileSync(new URL('../../../tests/fixtures/migration/workflow/c03-02-replanned-contract-digest.txt', import.meta.url), 'utf8').trim();
const noPathTaskContract = readFileSync(new URL('../../../tests/fixtures/migration/workflow/c03-02-contract-no-path.md', import.meta.url), 'utf8');

function evidence(taskContract, fileRows = []) {
  const acRows = taskAcRefs(taskContract).map((id) => `| \`${id}\` | Node workflow regression scenario | 通过 | Node 24.21.0 assertion passed in isolated fixture |`);
  return `## 文件改动\n\n> **交付结果**：SDD workflow runtime behavior verified.\n\n| 文件 | 操作 | 行为影响 |\n| --- | --- | --- |\n${fileRows.join('\n')}\n\n## 验证结果\n\n- **结论**：通过\n\n| AC / 场景 | 检查 | 结果 | 证据 |\n| --- | --- | --- | --- |\n${acRows.join('\n')}\n\n## 自审结论\n\n- **已修复问题**：Receipt descriptor compatibility and lifecycle error cases verified.\n- **契约偏差**：无\n\n## 剩余问题\n\n- **未验证项**：无\n- **剩余风险**：Full project integration remains a Main validation responsibility.\n\n## 快照影响\n\n- **范围**：technology\n- **说明**：No Current Truth snapshot is changed by this Task.\n`;
}

test('current canonical planning matches its frozen digest while the historical vector remains separate', (t) => {
  const project = makeRepo(t);
  const c = context(project.root, 'CHG-20260928-nodejs-migration', TASK_ID);
  assert.deepEqual([...planningComplete(project.root, c.change, c.fields)].sort(), ['AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05', 'AC-06', 'AC-07', 'AC-08', 'AC-09', 'AC-10', 'AC-11', 'AC-12']);
  const digest = contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields);
  assert.equal(digest, frozenDigest);
  assert.notEqual(digest, goldenDigest);

  for (const file of [
    path.join(c.change, c.fields.contract),
    path.join(c.change, c.fields.design),
    path.join(c.directory, c.taskFields.contract),
  ]) {
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original.replace(/\r?\n/gu, '\r\n'), 'utf8');
  }
  assert.equal(contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields), frozenDigest);
});

test('a separate no-path Task fixture remains readiness-valid and CRLF scoped digest stable', (t) => {
  const project = makeRepo(t);
  const c = context(project.root, 'CHG-20260928-nodejs-migration', TASK_ID);
  const taskPath = path.join(c.directory, c.taskFields.contract);
  assert.doesNotMatch(noPathTaskContract, /^### Path Contract$/mu);
  writeFileSync(taskPath, noPathTaskContract);
  assert.deepEqual([...planningComplete(project.root, c.change, c.fields)].sort(), ['AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05', 'AC-06', 'AC-07', 'AC-08', 'AC-09', 'AC-10', 'AC-11', 'AC-12']);
  const digest = contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields);

  for (const file of [
    path.join(c.change, c.fields.contract),
    path.join(c.change, c.fields.design),
    taskPath,
  ]) {
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original.replace(/\r?\n/gu, '\r\n'), 'utf8');
  }
  assert.equal(contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields), digest);
});

test('readiness rejects newly unfinished design content without relaxing fixed planning requirements', (t) => {
  const project = makeRepo(t);
  const c = context(project.root, 'CHG-20260928-nodejs-migration', TASK_ID);
  const design = path.join(c.change, c.fields.design);
  const text = readFileSync(design, 'utf8');
  writeFileSync(design, `${text}\nTODO: fill this later\n`, 'utf8');
  assert.throws(() => planningComplete(project.root, c.change, c.fields), /unfinished planning field/u);
});

test('delivery ignores conflicting legacy allow/deny rows while retaining exact diff and operation checks', (t) => {
  const project = makeRepo(t);
  const { taskContract: original } = projectTask(project);
  const taskContract = original.replace(
    /### Path Contract\n[\s\S]*?(?=^### 代码结构 \/ 模块落点$)/mu,
    '### Path Contract\n\n| 规则 | 路径 |\n| --- | --- |\n| allow | `docs/03-architecture/**` |\n| deny | `docs/03-architecture/**` |\n\n',
  );
  assert.notEqual(taskContract, original);
  const filename = 'docs/03-architecture/legacy-denied-output.txt';
  mkdirSync(path.dirname(path.join(project.root, filename)), { recursive: true });
  writeFileSync(path.join(project.root, filename), 'legacy table is not an authorization gate\n');
  const resultRevision = commit(project.root, 'add file denied by legacy table');
  const body = evidence(taskContract, [`| \`${filename}\` | A | Delivery records the actual changed file without path authorization. |`]);
  assert.deepEqual([...validateEvidence(project.root, project.base, resultRevision, body, taskContract)], [[filename, 'A']]);
  assert.throws(() => validateEvidence(project.root, project.base, resultRevision, evidence(taskContract), taskContract), /File notes must match Git diff/u);
  assert.throws(() => validateEvidence(
    project.root, project.base, resultRevision,
    evidence(taskContract, [`| \`${filename}\` | M | Wrong operation for the committed addition. |`]), taskContract,
  ), /Incorrect Git operation/u);
});

test('structured Delivery requires exact AC coverage and blocks pass claims with unverified work', (t) => {
  const project = makeRepo(t);
  const { taskContract } = projectTask(project);
  const valid = evidence(taskContract);
  const result = structuredDelivery(valid, taskContract);
  assert.deepEqual(result.expected_acs, ['AC-03', 'AC-04', 'AC-05']);
  assert.deepEqual(result.ac_results, { 'AC-03': '通过', 'AC-04': '通过', 'AC-05': '通过' });
  assert.throws(() => structuredDelivery(valid.replace('| `AC-04` | Node workflow regression scenario | 通过 | Node 24.21.0 assertion passed in isolated fixture |\n', ''), taskContract), /missing=AC-04/u);
  assert.throws(() => structuredDelivery(valid.replace('- **未验证项**：无', '- **未验证项**：host-specific smoke not run'), taskContract), /cannot claim 通过/u);
  assert.throws(() => structuredDelivery(valid.replace('`AC-05`', '`AC-99`'), taskContract), /missing=AC-05; unknown=AC-99/u);
});

test('real diff evidence validates Unicode paths, operations, and AC results without path authorization', (t) => {
  const project = makeRepo(t);
  const { taskContract } = projectTask(project);
  const filename = 'lib/workflow/engine with 雪.js';
  mkdirSync(path.join(project.root, 'lib/workflow'), { recursive: true });
  writeFileSync(path.join(project.root, filename), 'export const workflow = true;\n');
  const resultRevision = commit(project.root, 'add workflow fixture');
  const body = evidence(taskContract, [`| \`${filename}\` | A | New workflow entrypoint resolves within the task-owned module boundary. |`]);
  const changed = validateEvidence(project.root, project.base, resultRevision, body, taskContract);
  assert.deepEqual([...changed], [[filename, 'A']]);
});

function projectTask(project) {
  const c = context(project.root, 'CHG-20260928-nodejs-migration', TASK_ID);
  return { ...c, taskContract: readFileSync(path.join(c.directory, c.taskFields.contract), 'utf8') };
}
