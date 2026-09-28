import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runObserve } from '../../../lib/observation/cli.js';
import { SECRET, baseRows, endRow, envelope, writeRows } from './helpers.js';

const capture = () => ({ value: '', write(text) { this.value += String(text); } });
async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-cli-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project'), rules = path.join(temp, 'rules'), sessions = path.join(temp, 'sessions'), state = path.join(temp, 'state');
  await Promise.all([mkdir(project), mkdir(rules), mkdir(sessions), mkdir(state)]);
  await chmod(state, 0o700);
  return { temp, project, rules, sessions, state, db: path.join(state, 'observations.sqlite3') };
}

test('observe collect/report preserve JSON and report semantics with SQLite output outside project', async (t) => {
  const { project, rules, sessions, db } = await fixture(t);
  const trace = path.join(sessions, 'root.jsonl');
  await writeRows(trace, [
    ...baseRows('root', { cwd: project, base_instructions: SECRET }),
    envelope('response_item', { type: 'function_call', call_id: 'call', namespace: 'agents', name: 'spawn_agent', arguments: JSON.stringify({ agent_type: 'explorer', prompt: SECRET }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'call', output: JSON.stringify({ error: SECRET }) }, 4),
    endRow(),
  ]);
  const out = capture(), err = capture();
  const status = await runObserve(['--db', db, 'collect', '--run', 'inspect-one', '--root', project, '--session-file', trace, '--sessions-dir', sessions, '--rules-root', rules, '--expected-mode', 'sdd', '--expect-role', 'explorer'], { stdout: out, stderr: err });
  assert.equal(status, 0, err.value);
  const result = JSON.parse(out.value);
  assert.equal(result.run, 'inspect-one');
  assert.equal(result.diagnostic_model_calls, 0);
  assert.equal(out.value.includes(SECRET), false);

  const reportOut = capture();
  assert.equal(await runObserve(['--db', db, 'report', '--run', 'inspect-one', '--format', 'json'], { stdout: reportOut, stderr: err }), 0);
  const report = JSON.parse(reportOut.value);
  assert.equal(report.run_id, 'inspect-one');
  assert.ok(report.findings.some((finding) => finding.rule === 'D01'));
  assert.equal((await readFile(db)).includes(Buffer.from(SECRET)), false);
});

test('artifact-only host coverage stays partial and non-Codex native scan is rejected', async (t) => {
  const { project, rules, db } = await fixture(t);
  const out = capture(), err = capture();
  assert.equal(await runObserve(['--host', 'opencode', '--db', db, 'collect', '--run', 'open-run', '--root', project, '--rules-root', rules], { stdout: out, stderr: err }), 0, err.value);
  assert.equal(JSON.parse(out.value).coverage.status, 'partial');
  const rejected = capture();
  assert.equal(await runObserve(['--host', 'claude', '--db', db, 'scan', '--root', project], { stdout: capture(), stderr: rejected }), 1);
  assert.match(rejected.value, /scan is unsupported/);
});

test('invalid scope and database-inside-project fail without creating user-tree data', async (t) => {
  const { project, rules, sessions, db } = await fixture(t);
  const trace = path.join(sessions, 'root.jsonl'); await writeRows(trace, [...baseRows('root'), endRow()]);
  const out = capture(), err = capture();
  const innerDb = path.join(project, 'observations.sqlite3');
  assert.equal(await runObserve(['--db', innerDb, 'collect', '--run', 'x', '--root', project, '--session-file', trace, '--rules-root', rules], { stdout: out, stderr: err }), 1);
  assert.match(err.value, /outside the project/);
  await assert.rejects(readFile(innerDb), { code: 'ENOENT' });
  const missingTurn = capture();
  assert.equal(await runObserve(['--db', db, 'collect', '--root', project, '--session-file', trace, '--rules-root', rules], { stdout: capture(), stderr: missingTurn }), 1);
  assert.match(missingTurn.value, /--run is required/);
});


test('state-home precedence is host-independent and private, rather than derived from Codex home', async (t) => {
  const { project, rules, state } = await fixture(t);
  const previous = Object.fromEntries(['OPEN_SPEC_MESH_STATE_HOME', 'XDG_STATE_HOME', 'CODEX_HOME', 'OPEN_SPEC_MESH_HOST'].map((key) => [key, process.env[key]]));
  process.env.OPEN_SPEC_MESH_STATE_HOME = state;
  process.env.XDG_STATE_HOME = path.join(state, 'xdg-ignored');
  process.env.CODEX_HOME = path.join(state, 'codex-ignored');
  try {
    const out = capture(), err = capture();
    assert.equal(await runObserve(['--host', 'opencode', 'collect', '--run', 'state-run', '--root', project, '--rules-root', rules], { stdout: out, stderr: err }), 0, err.value);
    const database = path.join(state, 'observations.sqlite3');
    const { lstat } = await import('node:fs/promises');
    assert.equal((await lstat(database)).mode & 0o777, 0o600);
    assert.equal((await lstat(state)).mode & 0o777, 0o700);
    await assert.rejects(import('node:fs/promises').then(({ lstat }) => lstat(path.join(process.env.CODEX_HOME, 'observations.sqlite3'))), { code: 'ENOENT' });
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('database paths inside a nested Git tree are refused even when --root is a subdirectory', async (t) => {
  const { project, rules, sessions } = await fixture(t);
  const nested = path.join(project, 'nested'); await mkdir(nested);
  await mkdir(path.join(project, '.git'));
  const trace = path.join(sessions, 'root.jsonl'); await writeRows(trace, [...baseRows('root'), endRow()]);
  const out = capture(), err = capture();
  const insideGit = path.join(project, 'store.sqlite3');
  assert.equal(await runObserve(['--db', insideGit, 'collect', '--run', 'nested-run', '--root', nested, '--session-file', trace, '--rules-root', rules], { stdout: out, stderr: err }), 1);
  assert.match(err.value, /outside the project\/Git tree/);
  await assert.rejects(readFile(insideGit), { code: 'ENOENT' });
});
