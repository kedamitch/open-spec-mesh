import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { graphSchema } from '../../../lib/runtime/graph-schema.js';
import { context, contractDigest, document, metadata, readTextCompat } from '../../../lib/workflow/contract.js';
import { closeChange } from '../../../lib/workflow/closure.js';
import { runValidation } from '../../../lib/workflow/receipt.js';
import { writeValidationConfig, commit, git, makeRepo, CHANGE_ID } from './support.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function readTree(directory) {
  const output = new Map();
  const visit = (current) => {
    for (const name of (awaitlessReaddir(current)).sort()) {
      const file = path.join(current, name);
      const stat = statSync(file);
      if (stat.isDirectory()) visit(file);
      else output.set(path.relative(directory, file).split(path.sep).join('/'), {
        bytes: readFileSync(file), mode: stat.mode & 0o777,
      });
    }
  };
  visit(directory);
  return output;
}
import { readdirSync as awaitlessReaddir } from 'node:fs';

function readyForClosure(t, { invalidCompletedIndex = false } = {}) {
  const project = makeRepo(t);
  const activeParent = path.dirname(project.change);
  const completedParent = path.join(project.root, 'docs/05-changes/C02-已完成');
  if (invalidCompletedIndex) {
    writeFileSync(path.join(completedParent, 'index.md'), '# Broken index\n<!-- INDEX:BEGIN -->\n<!-- INDEX:BEGIN -->\n<!-- INDEX:END -->\n');
  }

  mkdirSync(path.join(project.root, 'docs/08-quality'), { recursive: true });
  mkdirSync(path.join(project.root, 'scripts'), { recursive: true });
  writeFileSync(path.join(project.root, 'scripts/check.js'), 'process.stdout.write("fixture checks passed\\n");\n');

  const c = context(project.root, CHANGE_ID);
  for (const task of c.graph.tasks) {
    task.state = 'accepted';
    task.history = [{ state: 'accepted', reason: 'isolated closure fixture', revision: project.base }];
    task.result_revision = project.base;
    task.baseline = project.base;
    task.attempt = 1;
  }
  graphSchema.save(c.graphPath, c.graph);
  for (const task of c.graph.tasks) {
    const current = context(project.root, CHANGE_ID, task.id);
    task.contract_digest = contractDigest(project.root, current.change, current.fields, current.directory, current.taskFields);
    const report = document(project.root, current.directory, current.taskFields, 'report');
    task.report_digest = sha256(Buffer.from(readTextCompat(report), 'utf8'));
  }
  graphSchema.save(c.graphPath, c.graph);
  project.integratedRevision = commit(project.root, 'closure fixture and integrated accepted graph');

  const changeContract = path.join(project.change, 'C01-change.md');
  let contract = readFileSync(changeContract, 'utf8');
  contract = contract
    .replace('integrated_revision: pending', `integrated_revision: ${project.integratedRevision}`)
    .replace('product: pending', 'product: No product snapshot change was required for this fixture.')
    .replace('technology: pending', 'technology: Workflow behavior is covered by isolated Node fixtures.')
    .replace('operations: pending', 'operations: No operations snapshot change was required for this fixture.');
  contract = contract.replace(
    /<!-- SDD:EVIDENCE:BEGIN -->[\s\S]*?<!-- SDD:EVIDENCE:END -->/u,
    '<!-- SDD:EVIDENCE:BEGIN -->\n## 验证结果\n\nAC-03, AC-04 and AC-05 isolated workflow checks passed.\n\n## 最终结论\n\npass\n<!-- SDD:EVIDENCE:END -->',
  );
  writeFileSync(changeContract, contract);
  writeValidationConfig(project.root, 'scripts/check.js');
  // Recreate the same committed Q01/script bytes, then leave only active Change evidence dirty.
  commit(project.root, 'version validation configuration and closure fixture');
  project.integratedRevision = git(project.root, 'rev-parse', 'HEAD');
  contract = readFileSync(changeContract, 'utf8').replace(/(?<=^integrated_revision: ).+$/mu, project.integratedRevision);
  writeFileSync(changeContract, contract);
  return { ...project, activeParent, completedParent, changeContract };
}

test('closure validates revision-bound receipt and refreshes both canonical Change indexes', async (t) => {
  const project = readyForClosure(t);
  const receipt = await runValidation(project.root, CHANGE_ID, project.integratedRevision);
  assert.equal(receipt.passed, true);
  const destination = await closeChange(project.root, CHANGE_ID);
  assert.equal(destination, path.join(project.completedParent, CHANGE_ID));
  const fields = metadata(readFileSync(path.join(destination, 'index.md'), 'utf8'))[0];
  assert.equal(fields.status, 'completed');
  assert.equal(fields.id, CHANGE_ID);
  assert.match(readFileSync(path.join(project.activeParent, 'index.md'), 'utf8'), /INDEX:BEGIN/u);
  assert.match(readFileSync(path.join(project.completedParent, 'index.md'), 'utf8'), new RegExp(CHANGE_ID));
});

test('closure failure restores active Change and both parent-index bytes and modes', async (t) => {
  const project = readyForClosure(t, { invalidCompletedIndex: true });
  await runValidation(project.root, CHANGE_ID, project.integratedRevision);
  const activeIndex = path.join(project.change, 'index.md');
  const activeParentIndex = path.join(project.activeParent, 'index.md');
  const completedParentIndex = path.join(project.completedParent, 'index.md');
  const snapshots = [activeIndex, activeParentIndex, completedParentIndex].map((file) => ({
    file, bytes: readFileSync(file), mode: statSync(file).mode & 0o777,
  }));
  const changeBefore = readTree(project.change);

  await assert.rejects(closeChange(project.root, CHANGE_ID), /Invalid index markers/u);
  assert.deepEqual(readTree(project.change), changeBefore);
  for (const snapshot of snapshots) {
    assert.deepEqual(readFileSync(snapshot.file), snapshot.bytes);
    assert.equal(statSync(snapshot.file).mode & 0o777, snapshot.mode);
  }
  assert.equal(existsSync(path.join(project.completedParent, CHANGE_ID)), false);
});
