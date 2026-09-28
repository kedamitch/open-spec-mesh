import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { REPO_ROOT } from './helpers.js';

const CHANGE_ID = 'CHG-20260928-wrapper-smoke';

function temporaryDirectory(t, prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function nodeOnlyPath(t) {
  const directory = temporaryDirectory(t, 'osm-node-only-path-');
  symlinkSync(process.execPath, path.join(directory, 'node'));
  symlinkSync('/usr/bin/dirname', path.join(directory, 'dirname'));
  assert.deepEqual(readdirSync(directory).sort(), ['dirname', 'node']);
  return directory;
}

function runWrapper(relativePath, args, { cwd, pathValue }) {
  return spawnSync('/bin/sh', [path.join(REPO_ROOT, relativePath), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: pathValue },
  });
}

test('close-change shell wrapper dispatches to Node, forwards options, and preserves exit codes', (t) => {
  const root = temporaryDirectory(t, 'osm close wrapper ');
  const minimalPath = nodeOnlyPath(t);
  const wrapper = 'sdd-close/scripts/close_change.sh';

  const help = runWrapper(wrapper, ['--help'], { cwd: root, pathValue: minimalPath });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: open-spec-mesh close-change CHANGE_ID \[--root PROJECT\]/u);

  const missing = runWrapper(wrapper, [CHANGE_ID, '--root', root], { cwd: REPO_ROOT, pathValue: minimalPath });
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, new RegExp(`Active Change not found: ${CHANGE_ID}`));

  const usage = runWrapper(wrapper, ['--unknown'], { cwd: root, pathValue: minimalPath });
  assert.equal(usage.status, 2, usage.stderr);
  assert.match(usage.stderr, /unrecognized arguments: --unknown/u);
});

test('new-release shell wrapper forwards positional/options and preserves handler exit codes', (t) => {
  const root = temporaryDirectory(t, 'osm release wrapper ');
  const minimalPath = nodeOnlyPath(t);
  const wrapper = 'sdd-release/scripts/new_release.sh';
  const help = runWrapper(wrapper, ['--help'], { cwd: root, pathValue: minimalPath });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: open-spec-mesh new-release VERSION TITLE --changes CHANGE_ID\.\.\. \[--root PROJECT\]/u);

  const completed = path.join(root, 'docs/05-changes/C02-已完成', CHANGE_ID);
  const releases = path.join(root, 'docs/09-delivery/D01-发布记录');
  mkdirSync(completed, { recursive: true });
  mkdirSync(releases, { recursive: true });
  writeFileSync(path.join(completed, 'index.md'), `---\nid: ${CHANGE_ID}\nstatus: completed\n---\n\n# Completed Change\n`);
  writeFileSync(path.join(releases, 'index.md'), '# Releases\n');

  const created = runWrapper(wrapper, ['1.2.3', 'WrapperForwarding', '--changes', CHANGE_ID, '--root', root], {
    cwd: REPO_ROOT,
    pathValue: minimalPath,
  });
  assert.equal(created.status, 0, created.stderr);
  const releasePath = created.stdout.trim();
  assert.ok(releasePath.startsWith(releases), releasePath);
  const index = readFileSync(path.join(releasePath, 'index.md'), 'utf8');
  assert.match(index, /version: 1\.2\.3/u);
  assert.match(index, /title: WrapperForwarding/u);
  assert.match(index, new RegExp(`changes: ${CHANGE_ID}`));

  const duplicate = runWrapper(wrapper, ['1.2.3', 'WrapperForwarding', '--changes', CHANGE_ID, '--root', root], {
    cwd: REPO_ROOT,
    pathValue: minimalPath,
  });
  assert.equal(duplicate.status, 1, duplicate.stderr);
  assert.match(duplicate.stderr, /Version already exists/u);
});
