import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRetiredPythonSources, walk } from '../../../scripts/check_runtime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('full Node retirement accepts no Python exceptions and preserves existing sources when reporting incomplete', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-no-python-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(verifyRetiredPythonSources(root), { files: [], retained: [] });
  fs.writeFileSync(path.join(root, 'backend.py'), 'user-preserved-content');
  assert.throws(() => verifyRetiredPythonSources(root), /migration is incomplete/);
  assert.equal(fs.readFileSync(path.join(root, 'backend.py'), 'utf8'), 'user-preserved-content');
});

test('approved GPU retirement removes first-party Python, service assets and Python automation without removing the Node client', () => {
  assert.deepEqual(verifyRetiredPythonSources(ROOT), { files: [], retained: [] });
  for (const relative of [
    'mcp/laya_batch_server.py', 'integrations/laya-gpu', 'tests/test_laya_server.py', '.github/workflows/laya.yml',
    'requirements.txt', 'pyproject.toml', 'Pipfile', 'Pipfile.lock', 'poetry.lock',
  ]) assert.equal(fs.existsSync(path.join(ROOT, relative)), false, `${relative} must remain retired`);
  assert.equal(fs.existsSync(path.join(ROOT, 'mcp/laya_http_mcp.js')), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.files.some((entry) => entry.includes('laya-gpu')), false);
  for (const workflow of walk(path.join(ROOT, '.github/workflows'), (file) => /\.ya?ml$/u.test(file))) {
    assert.doesNotMatch(fs.readFileSync(workflow, 'utf8'), /setup-python|python-version|\bpip\s+install\b|\bpython(?:3)?\s|laya_batch_server|test_laya_server|fastapi|uvicorn|httpx/u);
  }
});
