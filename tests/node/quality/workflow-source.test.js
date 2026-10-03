import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SOURCE, COPIES, START, END, syncWorkflow } from '../../../scripts/sync_workflow.js';

test('shared workflow has one source while all existing structural copies remain', () => {
  assert.deepEqual(syncWorkflow(), []);
  for (const p of ['docs/01-governance', 'docs/02-product', 'docs/03-architecture', 'docs/04-operations', 'docs/05-changes', 'docs/06-decisions', 'docs/07-research', 'docs/08-quality', 'docs/09-delivery']) assert.ok(fs.statSync(p).isDirectory());
});

test('sync detects drift without writes and preserves project-specific bytes on repair', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-workflow-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const p of [SOURCE, ...COPIES]) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), p === SOURCE ? '# common\n' : '# old\n'); }
  const before = `user preamble\r\n${START}\nold\n${END}\r\nprivate project rules\r\n`;
  fs.writeFileSync(path.join(root, 'AGENTS.md'), before);
  assert.equal(syncWorkflow(root).length, COPIES.length + 1);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), before);
  syncWorkflow(root, { write: true });
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), `user preamble\r\n${START}\n# common\n${END}\r\nprivate project rules\r\n`);
  assert.deepEqual(syncWorkflow(root), []);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'unmanaged user content\n');
  assert.throws(() => syncWorkflow(root, { write: true }), /refusing to replace user content/u);
});
