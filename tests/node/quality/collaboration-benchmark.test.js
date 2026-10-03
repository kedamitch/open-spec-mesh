import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collaborationScenarios } from '../../../lib/observation/evaluation.js';

test('fixed benchmark seed runs offline and local acceptance distinguishes defect from repair', (t) => {
  const fixture = JSON.parse(fs.readFileSync('sdd-init/references/collaboration-benchmark.json', 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-benchmark-seed-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, text] of Object.entries(fixture.baseline_files)) {
    assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), text);
  }
  assert.deepEqual(fixture.cases.map(c => c.scenario), collaborationScenarios().map(c => c.id));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const execute = args => spawnSync(process.execPath, ['--test', ...args], { cwd: root, env, encoding: 'utf8' });
  assert.equal(execute(['baseline.test.js']).status, 0);
  fs.writeFileSync(path.join(root, 'acceptance.test.js'), fixture.cases[0].acceptance_test);
  assert.equal(execute(['acceptance.test.js']).status, 1, 'Known defect must fail acceptance before repair');
  const source = path.join(root, 'src/store.js');
  fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('items.get(key)', 'items.get(normalize(key))'));
  assert.equal(execute(['baseline.test.js', 'acceptance.test.js']).status, 0);
});
