import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import test from 'node:test';
import { collectRecent, discover, sha, writeBundle } from '../../../lib/diagnostics/bundle.js';
import { baseRows, endRow, envelope, SECRET, writeRows } from '../observation/helpers.js';

async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-bundle-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project'), home = path.join(temp, 'codex'), rules = path.join(temp, 'rules'), sessions = path.join(home, 'sessions');
  await Promise.all([mkdir(project, { recursive: true }), mkdir(path.join(project, '.git'), { recursive: true }), mkdir(sessions, { recursive: true }), mkdir(rules, { recursive: true })]);
  return { temp, project, home, rules, sessions };
}

const selection = { days: 7, limit: 20, eligible_slices: 0, selected_slices: 0, exported_slices: 0, omitted_older_slices: 0, issues: { sessions_missing: 1 }, scope: 'recent_project_root_turns_not_a_single_task', sessions_scope: 'sessions_directory_only', expected_mode: 'unknown', expected_roles: [] };

test('empty bundle is useful, private, checksummed, and clearly not a successful execution', async (t) => {
  const { temp, project, home } = await fixture(t);
  const result = await writeBundle(project, home, [], [], selection, null, { now: new Date('2026-09-28T12:00:00.000Z') });
  assert.equal(result.status, 'no_sessions');
  assert.equal(result.runs, 0);
  assert.equal((await lstat(result.bundle)).mode & 0o777, 0o600);
  const archive = await JSZip.loadAsync(await import('node:fs/promises').then(({ readFile }) => readFile(result.bundle)));
  const manifest = JSON.parse(await archive.file('manifest.json').async('string'));
  assert.equal(manifest.status, 'no_sessions');
  assert.equal(manifest.diagnostic_model_calls, 0);
  assert.deepEqual(Object.keys(manifest.files).sort(), ['README.md', 'inventory.json', 'summary.md']);
  for (const [name, expected] of Object.entries(manifest.files)) assert.equal(sha(await archive.file(name).async('nodebuffer')), expected);
  assert.equal(archive.file('summary.md').unixPermissions & 0o777, 0o600);
  assert.equal(archive.file('README.md').unixPermissions & 0o170000, 0o100000);
});

test('recent diagnostic archive includes normalized evidence only and never exports raw source payload', async (t) => {
  const { temp, project, home, rules, sessions } = await fixture(t);
  const rows = [
    ...baseRows('root', { cwd: project, base_instructions: SECRET }),
    envelope('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: SECRET }] }, 3),
    endRow(),
  ];
  await writeRows(path.join(sessions, 'root.jsonl'), rows);
  const now = new Date('2026-09-28T12:00:00.000Z');
  const [runs, inventory, picked] = await collectRecent(project, home, sessions, rules, 7, 20, 'unknown', [], { now });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].metrics.diagnostic_model_calls, 0);
  assert.equal(picked.exported_slices, 1);
  const output = path.join(temp, 'private', 'report.zip');
  const result = await writeBundle(project, home, runs, inventory, picked, output, { now });
  const archive = await JSZip.loadAsync(await import('node:fs/promises').then(({ readFile }) => readFile(result.bundle)));
  const raw = Buffer.concat(await Promise.all(Object.values(archive.files).filter((file) => !file.dir).map((file) => file.async('nodebuffer')))).toString('utf8');
  assert.equal(raw.includes(SECRET), false);
  assert.equal(raw.includes(project), false);
  assert.ok(archive.file('reports/001.md'));
  assert.ok(archive.file('data/001.json'));
  const manifest = JSON.parse(await archive.file('manifest.json').async('string'));
  for (const [name, expected] of Object.entries(manifest.files)) assert.equal(sha(await archive.file(name).async('nodebuffer')), expected);
  assert.equal(result.status, 'ready');
});

test('discovery skips symlinks and excludes children, other projects, and malformed headers', async (t) => {
  const { temp, project, sessions } = await fixture(t);
  const linkedProject = path.join(temp, 'outside'); await mkdir(linkedProject);
  await writeRows(path.join(sessions, 'root.jsonl'), [...baseRows('root', { cwd: project }), endRow()]);
  await writeRows(path.join(sessions, 'child.jsonl'), [...baseRows('child', { cwd: project, parent_thread_id: 'root', agent_role: 'worker' }), endRow()]);
  await writeRows(path.join(sessions, 'other.jsonl'), [...baseRows('other', { cwd: linkedProject }), endRow()]);
  await writeRows(path.join(sessions, 'bad.jsonl'), [{ type: 'bad', payload: 'not a session header' }]);
  await symlink(path.join(sessions, 'root.jsonl'), path.join(sessions, 'alias.jsonl'));
  const [indexed, roots, issues] = await discover(project, sessions);
  assert.equal(indexed.has('root'), true);
  assert.deepEqual(roots.map((entry) => entry.id), ['root']);
  assert.ok((issues.unsupported_header ?? 0) >= 1);
  assert.equal(issues.symlink_skipped, 1);
});

test('publishing rejects project, Git-tree, existing, and symlink targets without overwrite', async (t) => {
  const { temp, project, home } = await fixture(t);
  const existing = path.join(home, 'existing.zip'); await (await import('node:fs/promises')).writeFile(existing, 'keep');
  await assert.rejects(writeBundle(project, home, [], [], selection, existing), /output_must_be_new_zip/);
  assert.equal(await (await import('node:fs/promises')).readFile(existing, 'utf8'), 'keep');
  await assert.rejects(writeBundle(project, home, [], [], selection, path.join(project, 'report.zip')), /keep_bundle_outside/);
  const other = path.join(temp, 'other-git'); await mkdir(path.join(other, '.git'), { recursive: true });
  await assert.rejects(writeBundle(project, home, [], [], selection, path.join(other, 'report.zip')), /keep_bundle_outside/);
  const link = path.join(temp, 'linked.zip'); await symlink(path.join(temp, 'missing'), link);
  await assert.rejects(writeBundle(project, home, [], [], selection, link), /symlink_path_refused/);
});

test('recent selection reports missing evidence and exports only the newest requested turns', async (t) => {
  const { project, home, rules, sessions } = await fixture(t);
  const emptyRuns = await collectRecent(project, home, path.join(home, 'missing-sessions'), rules, 7, 20, 'unknown', [], { now: new Date('2026-09-28T12:00:00Z') });
  assert.equal(emptyRuns[0].length, 0);
  assert.equal(emptyRuns[2].issues.sessions_missing, 1);
  const rows = [envelope('session_meta', { id: 'root', cwd: project, cli_version: '0.155.1', base_instructions: SECRET })];
  for (let i = 0; i < 4; i += 1) {
    const second = String(i * 3 + 1).padStart(2, '0');
    rows.push({ type: 'event_msg', timestamp: `2026-09-28T11:00:${second}Z`, payload: { type: 'task_started', turn_id: `turn-${i}` } });
    rows.push({ type: 'turn_context', timestamp: `2026-09-28T11:00:${String(i * 3 + 2).padStart(2, '0')}Z`, payload: { turn_id: `turn-${i}`, model: 'gpt-test' } });
    rows.push({ type: 'event_msg', timestamp: `2026-09-28T11:00:${String(i * 3 + 3).padStart(2, '0')}Z`, payload: { type: 'task_complete' } });
  }
  await writeRows(path.join(sessions, 'root.jsonl'), rows);
  const [runs, , selection] = await collectRecent(project, home, sessions, rules, 7, 2, 'unknown', [], { now: new Date('2026-09-28T12:00:00Z') });
  assert.deepEqual(runs.map((run) => run.turn), ['turn-3', 'turn-2']);
  assert.equal(selection.eligible_slices, 4);
  assert.equal(selection.omitted_older_slices, 2);
});

test('child discovery follows confirmed IDs only, excludes other projects, and duplicate IDs have no winner', async (t) => {
  const { temp, project, home, rules, sessions } = await fixture(t);
  const rootRows = [
    ...baseRows('root', { cwd: project }),
    envelope('response_item', { type: 'function_call', call_id: 'spawn', name: 'spawn_agent', namespace: 'agents', arguments: JSON.stringify({ agent_type: 'worker' }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: 'child' }) }, 4),
    endRow(),
  ];
  await writeRows(path.join(sessions, 'root.jsonl'), rootRows);
  await writeRows(path.join(sessions, 'child.jsonl'), [...baseRows('child', { cwd: project, parent_thread_id: 'root', agent_role: 'worker' }), endRow(30)]);
  const other = path.join(temp, 'other-project'); await mkdir(other);
  await writeRows(path.join(sessions, 'other.jsonl'), [...baseRows('other', { cwd: other }), endRow()]);
  const [runs] = await collectRecent(project, home, sessions, rules, 7, 20, 'unknown', [], { now: new Date('2026-09-28T12:00:00Z') });
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].sessions.map((session) => session.id), ['root', 'child']);

  const duplicates = path.join(temp, 'duplicates'); await mkdir(duplicates);
  await writeRows(path.join(duplicates, 'a.jsonl'), [...baseRows('same', { cwd: project }), endRow()]);
  await writeRows(path.join(duplicates, 'b.jsonl'), [...baseRows('same', { cwd: project }), endRow()]);
  const [noWinner, , selection] = await collectRecent(project, home, duplicates, rules, 7, 20, 'unknown', [], { now: new Date('2026-09-28T12:00:00Z') });
  assert.equal(noWinner.length, 0);
  assert.equal(selection.issues.duplicate_session, 1);
});

test('archive names are fixed relative paths and repeated private bundles never overwrite', async (t) => {
  const { project, home } = await fixture(t);
  const first = await writeBundle(project, home, [], [], selection, null, { now: new Date('2026-09-28T12:00:00Z') });
  const second = await writeBundle(project, home, [], [], selection, null, { now: new Date('2026-09-28T12:00:00Z') });
  assert.notEqual(first.bundle, second.bundle);
  const archive = await JSZip.loadAsync(await import('node:fs/promises').then(({ readFile }) => readFile(first.bundle)));
  for (const name of Object.keys(archive.files)) {
    assert.equal(name.startsWith('/'), false);
    assert.equal(name.split('/').includes('..'), false);
  }
});
