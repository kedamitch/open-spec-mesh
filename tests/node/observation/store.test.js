import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withStore, runScopeKey } from '../../../lib/observation/store.js';
import { parseLosslessJson } from '../../../lib/runtime/compat-json.js';

const fixtureDir = new URL('../../fixtures/migration/observation/', import.meta.url);
const scope = { project_key: 'fixture-project', root_session: 'fixture-root', turn: 'fixture-turn', expectation: { mode: 'unknown', roles: [], source: 'operator_not_model' }, sdd: { association: 'unknown', tasks: [], events: [] } };
const minimalRun = (projectKey, rootSession = 'root') => ({
  schema: 1, collected_at: '2026-09-28T00:00:00.000Z', host: { name: 'codex', native_trace: 'full' },
  project_key: projectKey, root_session: rootSession, turn: null,
  expectation: { mode: 'unknown', roles: [], source: 'operator_not_model' }, sessions: [], events: [],
  coverage: { status: 'observed', issues: [] }, snapshots: [], configuration_fingerprint: 'fixture',
  configuration_basis: 'current_inventory_not_proven_active', sdd: { association: 'unknown', tasks: [], events: [] },
  findings: [], metrics: { diagnostic_model_calls: 0 },
});
const runChild = (database, id, project) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [new URL('./store-worker.js', import.meta.url).pathname, database, id, project], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`)));
});

test('imports Python sqlite3 baseline bytes and preserves exact Python scope-key encoding', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-store-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const db = path.join(temp, 'golden.sqlite3');
  await copyFile(new URL('golden.sqlite3', fixtureDir), db); await chmod(db, 0o600);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', fixtureDir), 'utf8'));
  assert.equal(runScopeKey(scope), provenance.scope_key);
  const before = await withStore(db, (store) => store.load('golden-run'), { create: false });
  assert.equal(before.root_session, 'fixture-root');
  const updated = { ...before, findings: [{ rule: 'C01', category: 'unknown', conclusion: 'synthetic', evidence: [], action: 'review' }] };
  await withStore(db, (store) => store.save('golden-run', updated), { create: false });
  const after = await withStore(db, (store) => store.allRuns(), { create: false });
  assert.equal(after.length, 1);
  assert.equal(after[0].findings[0].rule, 'C01');
  assert.equal((await lstat(db)).mode & 0o777, 0o600);
});

test('foreign DB, malformed schema, permissions, and recovery sidecars are refused without replacing bytes', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-store-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const foreign = path.join(temp, 'foreign.sqlite3');
  await writeFile(foreign, Buffer.from('SQLite format 3\0foreign synthetic fixture'));
  await chmod(foreign, 0o600);
  const foreignBefore = await readFile(foreign);
  await assert.rejects(withStore(foreign, () => {}, { create: false }), /corrupt or unsupported|observation store/);
  assert.deepEqual(await readFile(foreign), foreignBefore);

  const db = path.join(temp, 'state', 'observations.sqlite3');
  await withStore(db, (store) => store.save('one', minimalRun('project')));
  const before = await readFile(db);
  await writeFile(`${db}-wal`, 'synthetic sidecar');
  await assert.rejects(withStore(db, (store) => store.save('two', minimalRun('project', 'other'))), /sidecars/);
  assert.deepEqual(await readFile(db), before);

  const modeDb = path.join(temp, 'mode.sqlite3');
  await copyFile(db, modeDb); await chmod(modeDb, 0o640);
  await assert.rejects(withStore(modeDb, () => {}, { create: false }), /permissions/);
});

test('run IDs are idempotent only within the same scope and conflicts do not alter persisted bytes', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-store-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const db = path.join(temp, 'observations.sqlite3');
  await withStore(db, (store) => store.save('same-id', minimalRun('project', 'root-a')));
  const before = await readFile(db);
  await assert.rejects(withStore(db, (store) => store.save('same-id', minimalRun('project', 'root-b'))), /different scope/);
  assert.deepEqual(await readFile(db), before);
  const update = minimalRun('project', 'root-a'); update.findings = [{ rule: 'D01' }];
  await withStore(db, (store) => store.save('same-id', update));
  assert.equal((await withStore(db, (store) => store.load('same-id'))).findings[0].rule, 'D01');
});

test('directory lock prevents concurrent processes from losing distinct run updates', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-store-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const db = path.join(temp, 'nested', 'observations.sqlite3');
  const ids = Array.from({ length: 8 }, (_, index) => `run-${index}`);
  await Promise.all(ids.map((id, index) => runChild(db, id, `project-${index}`)));
  const runs = await withStore(db, (store) => store.allRuns(), { create: false });
  assert.deepEqual(runs.map((run) => run.run_id).sort(), ids.sort());
});

test('ancestor symlink is refused before the target database is touched', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-store-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const actual = path.join(temp, 'actual'); await import('node:fs/promises').then(({ mkdir }) => mkdir(actual));
  const link = path.join(temp, 'link'); await symlink(actual, link);
  await assert.rejects(withStore(path.join(link, 'db.sqlite3'), () => {}), /Symlink/);
});
