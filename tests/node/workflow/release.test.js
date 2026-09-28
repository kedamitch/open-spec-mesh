import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runCheckRelease } from '../../../lib/release/check-release.js';
import { runNewRelease } from '../../../lib/release/new-release.js';
import { makeRepo, CHANGE_ID } from './support.js';

test('Release creation routes through the shared allocator and checks completed Change evidence', async (t) => {
  const { root } = makeRepo(t, { canonicalChange: false });
  const completed = path.join(root, 'docs/05-changes/C02-已完成', CHANGE_ID);
  const releaseParent = path.join(root, 'docs/09-delivery/D01-发布记录');
  mkdirSync(completed, { recursive: true });
  mkdirSync(releaseParent, { recursive: true });
  writeFileSync(path.join(completed, 'index.md'), `---\nid: ${CHANGE_ID}\nstatus: completed\n---\n\n# Completed Change\n`);
  writeFileSync(path.join(releaseParent, 'index.md'), '# Releases\n');

  let stdout = '';
  let stderr = '';
  const code = await runNewRelease(['1.2.3', 'Workflow-release', '--changes', CHANGE_ID, '--root', root], {
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } },
  });
  assert.equal(code, 0, stderr);
  const directory = stdout.trim();
  assert.ok(directory.startsWith(releaseParent));
  const index = readFileSync(path.join(directory, 'index.md'), 'utf8');
  assert.match(index, /version: 1\.2\.3/u);
  assert.match(index, new RegExp(`changes: ${CHANGE_ID}`));

  stdout = '';
  stderr = '';
  const checkBefore = await runCheckRelease([path.relative(root, directory), '--root', root], {
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } },
  });
  assert.equal(checkBefore, 1);
  assert.match(stderr, /Final decision must contain only pass/u);

  const fields = Object.fromEntries([...index.matchAll(/^([^:\n]+):\s*(.+)$/gmu)].map(([, key, value]) => [key, value]));
  const notesPath = path.join(directory, fields.note);
  const notes = readFileSync(notesPath, 'utf8').replace('## 最终结论\n\npending', '## 最终结论\n\npass');
  writeFileSync(notesPath, notes);
  const checklistPath = path.join(directory, fields.checklist);
  writeFileSync(checklistPath, readFileSync(checklistPath, 'utf8').replaceAll('- [ ]', '- [x]'));

  stdout = '';
  stderr = '';
  const checkAfter = await runCheckRelease([path.relative(root, directory), '--root', root], {
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } },
  });
  assert.equal(checkAfter, 0, stderr);
  assert.equal(stdout.trim(), '1.2.3');

  stdout = '';
  stderr = '';
  const duplicate = await runNewRelease(['1.2.3', 'Duplicate-version', '--changes', CHANGE_ID, '--root', root], {
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } },
  });
  assert.equal(duplicate, 1);
  assert.match(stderr, /Version already exists/u);
});
