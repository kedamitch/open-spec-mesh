import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from '../../../lib/documents/migrate.js';
import { initialize } from '../../../lib/documents/init.js';
import { validate } from '../../../lib/documents/validate.js';

function project() { return mkdtempSync(path.join(tmpdir(), 'osm migration fixture ')); }

test('migration moves legacy documentation without changing original bytes and writes an explicit map', async () => {
  const root = project();
  const oldDocs = path.join(root, 'docs');
  mkdirSync(path.join(oldDocs, 'old'), { recursive: true });
  const sourceBytes = Buffer.from('# Legacy\r\n原始内容\r\n', 'utf8');
  writeFileSync(path.join(oldDocs, 'old', 'legacy-note.md'), sourceBytes);
  writeFileSync(path.join(oldDocs, 'old', 'asset.bin'), Buffer.from([0, 1, 255]));
  const target = await migrate(root);
  assert.equal(target, path.join(root, 'docs/01-governance/G02-migration-map.md'));
  assert.deepEqual(readFileSync(path.join(root, '.sdd-migration/legacy-docs/old/legacy-note.md')), sourceBytes);
  assert.deepEqual(readFileSync(path.join(root, '.sdd-migration/legacy-docs/old/asset.bin')), Buffer.from([0, 1, 255]));
  const mapping = readFileSync(target, 'utf8');
  assert.match(mapping, /`old\/legacy-note\.md` \| 待迁移/u);
  assert.doesNotMatch(mapping, /asset\.bin/u);
  assert.deepEqual(validate(root), []);
});

test('canonical layout and an existing migration marker are rejected without mutation', async () => {
  const canonical = project();
  await initialize(canonical);
  const snapshot = readFileSync(path.join(canonical, 'docs/index.md'));
  await assert.rejects(migrate(canonical), /already uses the canonical/u);
  assert.deepEqual(readFileSync(path.join(canonical, 'docs/index.md')), snapshot);

  const marked = project();
  mkdirSync(path.join(marked, 'docs/legacy'), { recursive: true });
  writeFileSync(path.join(marked, 'docs/legacy/old.md'), 'old\n');
  mkdirSync(path.join(marked, '.sdd-migration'));
  await assert.rejects(migrate(marked), /already exists/u);
  assert.equal(readFileSync(path.join(marked, 'docs/legacy/old.md'), 'utf8'), 'old\n');
});

test('initialization failure restores original docs and removes the transient migration marker', async () => {
  const root = project();
  mkdirSync(path.join(root, 'docs/legacy'), { recursive: true });
  const bytes = Buffer.from('legacy\r\n');
  writeFileSync(path.join(root, 'docs/legacy/old.md'), bytes);
  mkdirSync(path.join(root, 'AGENTS.md'));
  await assert.rejects(migrate(root), /AGENTS\.md must be a regular file/u);
  assert.deepEqual(readFileSync(path.join(root, 'docs/legacy/old.md')), bytes);
  assert.equal(existsSync(path.join(root, '.sdd-migration')), false);
  assert.equal(existsSync(path.join(root, 'docs/01-governance')), false);
});
