import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const patch = readFileSync(path.join(repoRoot, 'dsh/cordis.patch.yml'), 'utf8');

/** The preset's composition rows as `{ id, name }`, in file order. */
function presetRows() {
  const rows = [];
  let current;
  for (const line of patch.split('\n')) {
    const id = /^\s*- id:\s*(\S+)\s*$/.exec(line);
    if (id) {
      current = { id: id[1], name: undefined };
      rows.push(current);
      continue;
    }
    const name = /^\s*name:\s*'?([^'\n]+?)'?\s*$/.exec(line);
    if (name && current && current.name === undefined) current.name = name[1];
  }
  return rows;
}

test('preset rows never use a relative or absolute path: a row name resolves against the profile directory', () => {
  const offenders = presetRows().filter(({ name }) => !name || name.startsWith('.') || name.startsWith('/'));
  assert.deepEqual(
    offenders.map(({ id, name }) => `${id}: ${name}`),
    [],
    'a preset row imported with a relative name resolves beside the profile config, not beside this package',
  );
});

test('the gatekeeper row names the package subpath the profile can resolve', () => {
  const row = presetRows().find(({ id }) => id === 'sdd-gatekeeper');
  assert.equal(row?.name, 'open-spec-mesh/dsh');
  assert.equal(JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).exports['./dsh'], './dsh/index.mjs');
  assert.ok(existsSync(path.join(repoRoot, 'dsh/index.mjs')));
});
