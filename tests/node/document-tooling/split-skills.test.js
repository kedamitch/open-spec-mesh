import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize } from '../../../lib/documents/init.js';
import { runCommand, COMMAND_REGISTRY } from '../../../lib/cli/registry.js';
import { CORE_SKILLS } from '../../../lib/installation/installer.js';

const stages = ['sdd-req', 'sdd-design', 'sdd-plan'];
test('three discovered stage skills have separate names, resources and command entrypoints', () => {
  for (const skill of stages) {
    assert.ok(CORE_SKILLS.includes(skill));
    const text = fs.readFileSync(skill + '/SKILL.md', 'utf8');
    assert.equal(text.match(/^name: (.+)$/mu)[1], skill);
    assert.ok(text.match(/^description: (.+)$/mu)[1].length > 0);
    for (const [, link] of text.matchAll(/\]\(([^)]+)\)/gu)) {
      assert.ok(fs.existsSync(path.resolve(skill, link)), skill + ' missing resource ' + link);
    }
  }
  assert.equal(CORE_SKILLS.includes('sdd-change'), false);
  assert.equal(fs.existsSync('sdd-change/SKILL.md'), false);
  assert.equal(fs.existsSync('sdd-requirements'), false);
  assert.equal(CORE_SKILLS.includes('sdd-requirements'), false);
  for (const name of ['new_change.js', 'ensure_design.js', 'new_task.js', 'new_change.sh']) {
    assert.equal(fs.existsSync('sdd-change/scripts/' + name), false);
  }
  assert.equal(fs.existsSync('sdd-req/scripts/new_change.sh'), false);
  assert.equal(COMMAND_REGISTRY['new-change'][0], 'sdd-req/scripts/new_change.js');
  assert.equal(COMMAND_REGISTRY['ensure-design'][0], 'sdd-design/scripts/ensure_design.js');
  assert.equal(COMMAND_REGISTRY['new-task'][0], 'sdd-plan/scripts/new_task.js');
});

test('requirements, design and execution planning create only their own artifacts and preserve earlier work', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-split-stages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await initialize(root);
  let output = ''; let errors = '';
  const io = { stdout: { write: value => output += value }, stderr: { write: value => errors += value } };
  assert.equal(await runCommand('new-change', ['split-stages', '--root', root], io), 0, errors);
  const change = output.trim(); const id = path.basename(change);
  const requirements = fs.readFileSync(path.join(change, 'C01-change.md'));
  assert.equal(fs.existsSync(path.join(change, 'C02-design.md')), false);
  assert.equal(fs.existsSync(path.join(change, 'C03-tasks')), false);
  output = '';
  assert.equal(await runCommand('ensure-design', [id, '--root', root], io), 0, errors);
  const design = path.join(change, 'C02-design.md');
  assert.equal(fs.existsSync(path.join(change, 'C03-tasks')), false);
  fs.writeFileSync(design, '# User-confirmed overall design\nKeep this content.\n');
  const designBytes = fs.readFileSync(design);
  assert.equal(await runCommand('ensure-design', [id, '--root', root], io), 0, errors);
  assert.deepEqual(fs.readFileSync(design), designBytes);
  output = '';
  assert.equal(await runCommand('new-task', [id, 'first-capability', '--root', root], io), 0, errors);
  const task1 = output.trim(); output = '';
  assert.equal(await runCommand('new-task', [id, 'second-capability', '--depends-on', 'C03-01', '--root', root], io), 0, errors);
  const task2 = output.trim();
  const tasks = path.join(change, 'C03-tasks');
  const plan = fs.readFileSync(path.join(tasks, 'C03-task-plan.md'), 'utf8');
  assert.match(plan, /# 执行计划/u);
  assert.ok(plan.includes(path.basename(task1)) && plan.includes(path.basename(task2)));
  assert.match(plan, /依赖：C03-01/u);
  const task = fs.readFileSync(path.join(task2, 'C03-02-01-task.md'), 'utf8');
  assert.match(task, /任务级设计/u); assert.match(task, /交付输出/u); assert.match(task, /验收与验证/u);
  assert.ok(task.includes('../../C02-design.md'));
  assert.deepEqual(fs.readFileSync(path.join(change, 'C01-change.md')), requirements);
  assert.deepEqual(fs.readFileSync(design), designBytes);
  assert.equal(fs.existsSync(path.join(tasks, 'C03-task-graph.json')), false);
  assert.equal(fs.readdirSync(task1).some(name => name.includes('delivery')), false);
  assert.equal(fs.readdirSync(task2).some(name => name.includes('delivery')), false);
  assert.equal(fs.existsSync(path.join(root, '.worktrees')), false);
});
