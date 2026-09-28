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

test('Change/Task, Research and ADR preserve templates, names and planned Graph schema', async () => {
  const root = project();
  await initialize(root);
  const change = await createChange(root, 'feature-change');
  const changeId = path.basename(change);
  const task = await createTask(root, changeId, 'document-work');
  const taskId = path.basename(task).split('-', 2).slice(0, 2).join('-');
  const graphPath = path.join(change, 'C03-tasks/C03-task-graph.json');
  const graph = parseLosslessJson(readFileSync(graphPath, 'utf8'));
  assert.deepEqual(graph.tasks.map((entry) => ({ id: entry.id, state: entry.state, depends_on: entry.depends_on, history: entry.history })), [
    { id: taskId, state: 'planned', depends_on: [], history: [] },
  ]);
  assert.equal(Object.hasOwn(graph, 'acceptance'), false);
  assert.ok(existsSync(path.join(task, 'C03-01-01-task.md')));
  assert.ok(existsSync(path.join(task, 'C03-01-02-delivery.md')));
  const generatedTask = readFileSync(path.join(task, 'C03-01-01-task.md'), 'utf8');
  assert.ok(generatedTask.includes('Task `' + taskId + '`'));
  assert.doesNotMatch(generatedTask, /Path Contract|allow\/deny|^\|\s*(?:allow|deny)\s*\|/imu);
  for (const requiredSection of [
    '### 要做', '### 不做', '### 输入 / 依赖', '### 代码结构 / 模块落点',
    '## Task 实现流程', '### Components', '### 接口变化', '### 领域模型 / 状态变化',
    '### 数据与表结构变化', '### 失败与兼容', '### Tests', '### 验收标准',
    '## 实现自由度', '### Expected Output',
  ]) assert.ok(generatedTask.includes(requiredSection), `generated Task is missing ${requiredSection}`);
  const writingContract = readFileSync(path.resolve('sdd-init/references/document-contract.md'), 'utf8');
  const taskWritingRules = writingContract.split('## Task\n')[1]?.split('\n## Delivery')[0];
  assert.ok(taskWritingRules, 'document contract must define Task writing rules');
  assert.doesNotMatch(taskWritingRules, /Path Contract/u);
  assert.match(taskWritingRules, /不生成文件路径 allow\/deny 清单/u);
  assert.equal(await ensureDesign(root, changeId), path.join(change, 'C02-design.md'));

  assert.throws(() => createTask(root, changeId, 'duplicate-dependency', [taskId, taskId]), /Duplicate dependencies/u);
  await assert.rejects(createTask(root, changeId, 'unknown-dependency', ['C99-99']), /Unknown dependency/u);

  const research = await createResearch(root, 'evidence-note');
  const researchFile = path.join(research, 'R01-01-research-report.md');
  assert.deepEqual(readFileSync(researchFile), readFileSync(path.resolve('sdd-research/references/research-template.md')));
  const adr = await createAdr(root, '长期兼容决策');
  assert.match(path.basename(adr), /^ADR-001-decision\.md$/u);
  const sourceAdr = readFileSync(path.resolve('sdd-research/references/adr-template.md'), 'utf8');
  const expectedAdr = `# 长期兼容决策\n${sourceAdr.slice(sourceAdr.indexOf('\n') + 1)}`;
  assert.equal(readFileSync(adr, 'utf8'), expectedAdr);
  assert.deepEqual(validate(root), []);
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
  cpSync(path.resolve('lib'), library, { recursive: true });
  const module = await import(pathToFileURL(path.join(library, 'documents/create.js')).href);
  assert.equal(module.readResource('common.js'), readFileSync(path.join(library, 'documents/common.js'), 'utf8'));
});
