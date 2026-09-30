import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
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

test('every canonical scaffold file and required diagram is indexed', async () => {
  const root = project();
  await initialize(root);
  const manifest = JSON.parse(readFileSync(path.resolve('sdd-init/templates/scaffold-manifest.json'), 'utf8'));
  for (const relative of manifest.files) {
    const file = path.join(root, 'docs', relative);
    assert.equal(existsSync(file), true, relative);
    const index = readFileSync(path.join(path.dirname(file), 'index.md'), 'utf8');
    assert.ok(index.includes(`](${path.basename(file)})`), `${relative} is missing from its parent index`);
  }
  for (const relative of [
    '02-product/P03-diagrams/P03-01-product-architecture.md',
    '02-product/P03-diagrams/P03-02-main-user-flow.md',
    '03-architecture/T05-diagrams/T05-01-system-context.md',
    '03-architecture/T05-diagrams/T05-02-application-architecture.md',
    '03-architecture/T05-diagrams/T05-03-main-sequence.md',
    '03-architecture/T05-diagrams/T05-04-domain-state.md',
    '04-operations/O03-diagrams/O03-01-deployment-architecture.md',
  ]) assert.equal(existsSync(path.join(root, 'docs', relative)), true, relative);
});

test('initialization restores a missing diagram without replacing sibling edits', async () => {
  const root = project();
  await initialize(root);
  const directory = path.join(root, 'docs/03-architecture/T05-diagrams');
  const missing = path.join(directory, 'T05-03-main-sequence.md');
  const sibling = path.join(directory, 'T05-02-application-architecture.md');
  unlinkSync(missing);
  writeFileSync(sibling, '# User-verified architecture\nPreserve these bytes.\n');
  await initialize(root);
  assert.equal(existsSync(missing), true);
  assert.equal(readFileSync(sibling, 'utf8'), '# User-verified architecture\nPreserve these bytes.\n');
  assert.ok(readFileSync(path.join(directory, 'index.md'), 'utf8').includes('T05-03-main-sequence.md'));
});

test('new project rules match the compact template without global role policies', async () => {
  const root = project();
  await initialize(root);
  const generated = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const template = readFileSync(path.resolve('sdd-init/references/project-agents-template.md'), 'utf8');
  assert.equal(generated, template);
  assert.match(generated, /单任务或串行由当前 Agent/);
  assert.match(generated, /role_desc/);
  assert.equal(generated.includes('Complex'), false);
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
