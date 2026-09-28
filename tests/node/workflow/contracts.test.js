import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { context, contractDigest } from '../../../lib/workflow/contract.js';
import { planningComplete } from '../../../lib/workflow/readiness.js';
import { validateChangedPaths } from '../../../lib/workflow/path-contract.js';
import { structuredDelivery, taskAcRefs, validateEvidence } from '../../../lib/workflow/evidence.js';
import { commit, makeRepo, TASK_ID } from './support.js';

const goldenDigest = readFileSync(new URL('../../../tests/fixtures/migration/workflow/c03-02-contract-digest.txt', import.meta.url), 'utf8').trim();

function evidence(taskContract, fileRows = []) {
  const acRows = taskAcRefs(taskContract).map((id) => `| \`${id}\` | Node workflow regression scenario | 通过 | Node 24.21.0 assertion passed in isolated fixture |`);
  return `## 文件改动\n\n> **交付结果**：SDD workflow runtime behavior verified.\n\n| 文件 | 操作 | 行为影响 |\n| --- | --- | --- |\n${fileRows.join('\n')}\n\n## 验证结果\n\n- **结论**：通过\n\n| AC / 场景 | 检查 | 结果 | 证据 |\n| --- | --- | --- | --- |\n${acRows.join('\n')}\n\n## 自审结论\n\n- **已修复问题**：Receipt descriptor compatibility and lifecycle error cases verified.\n- **契约偏差**：无\n\n## 剩余问题\n\n- **未验证项**：无\n- **剩余风险**：Full project integration remains a Main validation responsibility.\n\n## 快照影响\n\n- **范围**：technology\n- **说明**：No Current Truth snapshot is changed by this Task.\n`;
}

test('complete canonical planning and scoped digest remain compatible with the frozen legacy vector', (t) => {
  const project = makeRepo(t);
  const c = context(project.root, 'CHG-20260928-nodejs-migration', TASK_ID);
  assert.deepEqual([...planningComplete(project.root, c.change, c.fields)].sort(), ['AC-01', 'AC-02', 'AC-03', 'AC-04', 'AC-05', 'AC-06', 'AC-07', 'AC-08', 'AC-09', 'AC-10', 'AC-11', 'AC-12']);
  assert.equal(contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields), goldenDigest);

  for (const file of [
    path.join(c.change, c.fields.contract),
    path.join(c.change, c.fields.design),
    path.join(c.directory, c.taskFields.contract),
  ]) {
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original.replace(/\r?\n/gu, '\r\n'), 'utf8');
  }
  assert.equal(contractDigest(project.root, c.change, c.fields, c.directory, c.taskFields), goldenDigest);
});

test('readiness rejects newly unfinished design content without relaxing fixed planning requirements', (t) => {
  const project = makeRepo(t);
  const c = context(project.root, 'CHG-20260928-nodejs-migration', TASK_ID);
  const design = path.join(c.change, c.fields.design);
  const text = readFileSync(design, 'utf8');
  writeFileSync(design, `${text}\nTODO: fill this later\n`, 'utf8');
  assert.throws(() => planningComplete(project.root, c.change, c.fields), /unfinished planning field/u);
});

test('Path Contract supports the authorized Release route, rejects denied paths, and deny wins', (t) => {
  const project = makeRepo(t);
  const { taskContract } = projectTask(project);
  assert.deepEqual(validateChangedPaths(taskContract, ['lib/release/new-release.js', 'tests/node/workflow/fixture.test.js']), ['lib/release/new-release.js', 'tests/node/workflow/fixture.test.js']);
  assert.throws(() => validateChangedPaths(taskContract, ['docs/03-architecture/T01-architecture-overview.md']), /outside allow paths|denied by/u);
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

test('real diff evidence validates Unicode paths, operations, AC results, and Path Contract together', (t) => {
  const project = makeRepo(t);
  const { taskContract } = projectTask(project);
  const filename = 'lib/workflow/engine with 雪.js';
  mkdirSync(path.join(project.root, 'lib/workflow'), { recursive: true });
  writeFileSync(path.join(project.root, filename), 'export const workflow = true;\n');
  const resultRevision = commit(project.root, 'add workflow fixture');
  const body = evidence(taskContract, [`| \`${filename}\` | A | New workflow entrypoint resolves within the task-owned module boundary. |`]);
  const changed = validateEvidence(project.root, project.base, resultRevision, body, taskContract, 'C03-02 Task Path Contract');
  assert.deepEqual([...changed], [[filename, 'A']]);
});

function projectTask(project) {
  const c = context(project.root, 'CHG-20260928-nodejs-migration', TASK_ID);
  return { ...c, taskContract: readFileSync(path.join(c.directory, c.taskFields.contract), 'utf8') };
}
