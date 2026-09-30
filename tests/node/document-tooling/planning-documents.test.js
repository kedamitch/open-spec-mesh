import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialize } from '../../../lib/documents/init.js';
import { createDocument } from '../../../lib/documents/create.js';
import { createChange, createTask, ensureDesign } from '../../../lib/documents/change.js';
import { createResearch, createAdr } from '../../../lib/documents/research.js';
import { parseLosslessJson } from '../../../lib/runtime/compat-json.js';
import { validate } from '../../../lib/documents/validate.js';

function project() { return mkdtempSync(path.join(tmpdir(), 'osm document fixture ')); }

test('Change and macro Tasks are incremental, preserve user design and never create execution Graph or empty Delivery', async () => {
  const root = project(); await initialize(root);
  const change = await createChange(root, 'feature-change'); const id = path.basename(change);
  assert.ok(existsSync(path.join(change, 'C01-change.md')));
  assert.equal(existsSync(path.join(change, 'C02-design.md')), false);
  assert.equal(existsSync(path.join(change, 'C03-tasks')), false);
  const design = await ensureDesign(root, id); writeFileSync(design, '# User design\n');
  assert.equal(await ensureDesign(root, id), design); assert.equal(readFileSync(design, 'utf8'), '# User design\n');
  const task = await createTask(root, id, 'document-work');
  assert.ok(existsSync(path.join(task, 'C03-01-01-task.md')));
  assert.equal(existsSync(path.join(task, 'C03-01-02-delivery.md')), false);
  assert.equal(existsSync(path.join(change, 'C03-tasks/C03-task-graph.json')), false);
  assert.match(readFileSync(path.join(change, 'C03-tasks/C03-task-plan.md'), 'utf8'), /C03-01/);
  const next = await createTask(root, id, 'second', ['C03-01', 'C03-01']);
  assert.match(readFileSync(path.join(next, 'C03-02-01-task.md'), 'utf8'), /C03-01/);
  assert.throws(() => createTask(root, id, 'invalid', ['../escape']), /Dependencies/);
  const research = await createResearch(root, 'evidence-note');
  assert.deepEqual(readFileSync(path.join(research, 'R01-01-research-report.md')), readFileSync(path.resolve('sdd-research/references/research-template.md')));
  const adr = await createAdr(root, '长期兼容决策'); assert.match(path.basename(adr), /^ADR-001-decision\.md$/u);
  assert.deepEqual(validate(root), []);
});

test('product and architecture references retain required semantics while legacy templates stay compact', () => {
  const product = readFileSync(path.resolve('sdd-init/references/product-writing.md'), 'utf8');
  const architecture = readFileSync(path.resolve('sdd-init/references/architecture-writing.md'), 'utf8');
  for (const value of ['产品架构', '模块', '核心能力', '权限', '失败', '产品定位与边界']) assert.ok(product.includes(value), value);
  for (const value of ['API', 'Schema', 'Domain Model', 'stateDiagram-v2', 'sequenceDiagram', '幂等', '失败 / 恢复']) assert.ok(architecture.includes(value), value);
  for (const file of ['prd-spec/references/product-template.md', 'design-overview/references/architecture-template.md']) {
    assert.ok(readFileSync(path.resolve(file), 'utf8').length < 400, file);
  }
});

test('number allocation remains unique under concurrent writers', async () => {
  const root = project();
  await initialize(root);
  const outputs = await Promise.all([
    createDocument(root, 'docs/02-product', 'alpha-page'),
    createDocument(root, 'docs/02-product', 'beta-page'),
  ]);
  assert.deepEqual(outputs.map((entry) => path.basename(entry).slice(0, 3)).sort(), ['P04', 'P05']);
  assert.deepEqual(validate(root), []);
});


test('two independent processes allocate distinct consecutive document numbers', async () => {
  const root = project();
  await initialize(root);
  const worker = path.resolve('tests/node/document-tooling/allocator-worker.js');
  const startFile = path.join(root, 'start');
  const launch = (title) => {
    const child = spawn(process.execPath, [worker, root, title, startFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const exit = once(child, 'exit');
    return { child, exit, get output() { return output; }, get errors() { return errors; } };
  };
  const first = launch('parallel-alpha');
  const second = launch('parallel-beta');
  async function ready(worker) {
    while (!worker.output.includes('READY\n')) {
      if (worker.child.exitCode !== null) throw new Error(`allocator worker exited early: ${worker.errors}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  await Promise.all([ready(first), ready(second)]);
  writeFileSync(startFile, 'go');
  await Promise.all([first.exit, second.exit]);
  assert.equal(first.child.exitCode, 0, first.errors);
  assert.equal(second.child.exitCode, 0, second.errors);
  const names = [first.output.trim().split('\n').at(-1), second.output.trim().split('\n').at(-1)].map((entry) => path.basename(entry)).sort();
  assert.deepEqual(names.map((name) => name.match(/^P([0-9]{2})-/u)[1]).sort(), ['04', '05']);
  assert.deepEqual(names.map((name) => name.replace(/^P[0-9]{2}-/u, '')).sort(), ['parallel-alpha.md', 'parallel-beta.md']);
  assert.deepEqual(validate(root), []);
});

test('resource paths decode spaces in installed module locations', async () => {
  const root = project();
  const library = path.join(root, 'lib');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.resolve('lib'), library, { recursive: true });
  const module = await import(pathToFileURL(path.join(library, 'documents/create.js')).href);
  assert.equal(module.readResource('common.js'), readFileSync(path.join(library, 'documents/common.js'), 'utf8'));
});
