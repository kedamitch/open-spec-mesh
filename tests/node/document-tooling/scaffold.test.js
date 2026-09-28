import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initialize } from '../../../lib/documents/init.js';
import { createDocument } from '../../../lib/documents/create.js';
import { validate } from '../../../lib/documents/validate.js';
import { readTextCompat } from '../../../lib/runtime/text.js';

function project() { return mkdtempSync(path.join(tmpdir(), 'osm scaffold fixture ')); }

test('canonical scaffold initializes idempotently, preserves user files and refreshes every index', async () => {
  const root = project();
  await initialize(root);
  const product = path.join(root, 'docs/02-product/P01-product-overview.md');
  writeFileSync(product, '# User-owned content\n');
  const userDoc = path.join(root, 'docs/02-product/P98-user-guide.md');
  writeFileSync(userDoc, '# User guide\n');
  await initialize(root);
  assert.equal(readFileSync(product, 'utf8'), '# User-owned content\n');
  assert.equal(readFileSync(userDoc, 'utf8'), '# User guide\n');
  const rootIndex = readTextCompat(path.join(root, 'docs/index.md'));
  const productIndex = readTextCompat(path.join(root, 'docs/02-product/index.md'));
  assert.match(rootIndex, /<!-- INDEX:BEGIN -->[\s\S]*02-product/u);
  assert.match(productIndex, /P98-user-guide\.md/u);
  assert.deepEqual(validate(root), []);
  const validationTemplate = readTextCompat(path.resolve('sdd-init/templates/files/08-quality/Q01-validation.md'));
  assert.match(validationTemplate, /Node 验证入口/u);
  assert.doesNotMatch(validationTemplate, /Python 验证入口/u);
});

test('initialization fails before writing when a canonical number is occupied', async () => {
  const root = project();
  mkdirSync(path.join(root, 'docs/02-product'), { recursive: true });
  const collision = path.join(root, 'docs/02-product/P01-user-owned.md');
  writeFileSync(collision, 'keep these bytes\r\n');
  await assert.rejects(initialize(root), /Number occupied/u);
  assert.equal(readFileSync(collision, 'utf8'), 'keep these bytes\r\n');
  assert.equal(existsSync(path.join(root, 'docs/index.md')), false);
});

test('damaged index markers, symlink parents and invalid titles do not allocate a document', async () => {
  const root = project();
  await initialize(root);
  const index = path.join(root, 'docs/02-product/index.md');
  writeFileSync(index, '# Product\n<!-- INDEX:BEGIN -->\n<!-- INDEX:BEGIN -->\n');
  const before = readdirSync(path.dirname(index)).sort();
  await assert.rejects(createDocument(root, 'docs/02-product', 'new-page'), /Invalid index markers/u);
  assert.deepEqual(readdirSync(path.dirname(index)).sort(), before);
  assert.throws(() => createDocument(root, 'docs/02-product', 'bad title'), /English slug/u);
  const outside = project();
  symlinkSync(outside, path.join(root, 'docs/02-product/linked'), 'dir');
  await assert.rejects(createDocument(root, 'docs/02-product/linked', 'escaped'), /Symlink/u);
});
