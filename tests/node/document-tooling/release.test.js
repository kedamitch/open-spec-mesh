import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize } from '../../../lib/documents/init.js';
import { createRelease, runNewRelease } from '../../../lib/release/new-release.js';
import { checkRelease } from '../../../lib/release/check-release.js';

async function project(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'osm-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await initialize(root);
  return root;
}

test('Quick release materials require no fabricated completed Change', async (t) => {
  const root = await project(t);
  const directory = await createRelease(root, '0.0.2', 'quick-release');
  assert.match(readFileSync(path.join(directory, 'index.md'), 'utf8'), /version: 0\.0\.2/u);
  assert.equal(checkRelease(root, path.relative(root, directory)), '0.0.2');
  assert.deepEqual(readdirSync(path.join(root, 'docs/05-changes/C02-已完成')), ['index.md']);
  await assert.rejects(createRelease(root, '0.0.2', 'duplicate'), /Version already exists/u);
});

test('release CLI accepts a version and title without compulsory Change arguments', async (t) => {
  const root = await project(t); let output = ''; let errors = '';
  const code = await runNewRelease(['0.0.2', 'quick-release', '--root', root], {
    stdout: { write(text) { output += text; } }, stderr: { write(text) { errors += text; } },
  });
  assert.equal(code, 0); assert.equal(errors, '');
  assert.equal(checkRelease(root, path.relative(root, output.trim())), '0.0.2');
});

test('provided release Change references must still be unique and completed', async (t) => {
  const root = await project(t); const id = 'CHG-20260929-release-fixture';
  const completed = path.join(root, 'docs/05-changes/C02-已完成', id);
  mkdirSync(completed); writeFileSync(path.join(completed, 'index.md'), `---\nid: ${id}\nstatus: in-progress\n---\n`);
  await assert.rejects(createRelease(root, '0.0.2', 'release', [id]), /not completed/u);
  await assert.rejects(createRelease(root, '0.0.2', 'release', [id, id]), /unique completed/u);
  writeFileSync(path.join(completed, 'index.md'), `---\nid: ${id}\nstatus: completed\n---\n`);
  const directory = await createRelease(root, '0.0.2', 'release', [id]);
  assert.equal(checkRelease(root, path.relative(root, directory)), '0.0.2');
});
