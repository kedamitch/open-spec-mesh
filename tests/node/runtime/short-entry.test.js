import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { entryArguments, runEntry } from '../../../lib/cli/entry.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('osm without arguments explicitly invokes default Codex installation with tools skipped', () => {
  const args = [];
  assert.deepEqual(entryArguments(args, { short: true }), ['install', '--host', 'codex', '--skip-tools']);
  assert.deepEqual(args, []);
  assert.deepEqual(entryArguments([]), []);
});

test('help/version and ordinary subcommands stay transparent under the short entry', () => {
  for (const args of [['--help'], ['-h'], ['help'], ['--version'], ['-V'], ['install', '--host', 'claude'], ['init-project', '--root', '/tmp/p'], ['unknown']]) {
    assert.deepEqual(entryArguments(args, { short: true }), args);
    assert.notEqual(entryArguments(args, { short: true }), args);
  }
});

test('direct osm install options retain user overrides after shortcut defaults', () => {
  assert.deepEqual(entryArguments(['--dry-run', '--host', 'opencode'], { short: true }), ['install', '--host', 'codex', '--skip-tools', '--dry-run', '--host', 'opencode']);
});

test('short help/version and legacy no-argument help do not execute installation', async () => {
  let text = '';
  const stdout = { write: (value) => { text += value; } };
  assert.equal(await runEntry(['--help'], { short: true, stdout }), 0);
  assert.match(text, /Usage: osm <command>/u);
  assert.match(text, /No arguments: install --host codex --skip-tools/u);
  text = '';
  assert.equal(await runEntry([], { stdout }), 0);
  assert.match(text, /Usage: open-spec-mesh <command>/u);
  text = '';
  assert.equal(await runEntry(['--version'], { short: true, stdout }), 0);
  assert.match(text, /^\d+\.\d+\.\d+\n$/u);
});

test('unknown short subcommand preserves a failing exit code', async () => {
  let text = '';
  assert.equal(await runEntry(['not-a-command'], { short: true, stderr: { write: (value) => { text += value; } } }), 2);
  assert.match(text, /Unknown command/u);
});

test('osm direct dry-run previews without creating or configuring a host Home', (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'osm-short-preview-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'untouched Home');
  const result = spawnSync(process.execPath, [path.join(root, 'bin/osm.js'), '--dry-run'], { cwd: temp, encoding: 'utf8', env: { ...process.env, HOME: temp, CODEX_HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry-run: no target files changed/u);
  assert.equal(existsSync(home), false);
});
