import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

function git(root, args) {
  return spawnSync('git', ['-C', root, '-c', 'core.excludesfile=/dev/null', ...args], { encoding: 'utf8' });
}

test('root dependency output is ignored without hiding nested dependencies or lockfiles', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'osm gitignore fixture '));
  const initialized = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  copyFileSync(path.resolve('.gitignore'), path.join(root, '.gitignore'));

  mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  mkdirSync(path.join(root, 'nested/node_modules'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules/sentinel'), 'root sentinel\n');
  writeFileSync(path.join(root, 'nested/node_modules/sentinel'), 'nested sentinel\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{\n  "lockfileVersion": 3\n}\n');
  writeFileSync(path.join(root, 'npm-shrinkwrap.json'), '{\n  "lockfileVersion": 3\n}\n');

  const ignored = (relativePath) => git(root, ['check-ignore', '--quiet', '--', relativePath]);
  assert.equal(ignored('node_modules/sentinel').status, 0, 'root node_modules contents should be ignored');
  assert.equal(ignored('nested/node_modules/sentinel').status, 1, 'nested node_modules should remain visible');
  assert.equal(ignored('package-lock.json').status, 1, 'package-lock.json should remain trackable');
  assert.equal(ignored('npm-shrinkwrap.json').status, 1, 'npm-shrinkwrap.json should remain trackable');

  const status = git(root, ['status', '--short', '--untracked-files=all']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /\?\? package-lock\.json/u);
  assert.match(status.stdout, /\?\? npm-shrinkwrap\.json/u);
  assert.match(status.stdout, /\?\? nested\/node_modules\/sentinel/u);
  assert.doesNotMatch(status.stdout, /^\?\? node_modules\/sentinel$/mu);
  assert.equal(readFileSync(path.join(root, 'node_modules/sentinel'), 'utf8'), 'root sentinel\n');
  assert.equal(readFileSync(path.join(root, 'nested/node_modules/sentinel'), 'utf8'), 'nested sentinel\n');
});
