import { createRequire } from 'node:module';
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { legacyJson, parseLosslessJson } from '../runtime/compat-json.js';
import { atomicWrite } from '../runtime/io.js';
import { withStoreLock } from '../runtime/locks.js';
import { digest, identifier } from './trace.js';

export const APPLICATION_ID = 0x5344444f;
export const USER_VERSION = 1;
export const SCHEMA = `CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  report_json TEXT NOT NULL
);`;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');
let sqlPromise;
const require = createRequire(import.meta.url);

function sqlLibrary() {
  sqlPromise ??= initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  return sqlPromise;
}

async function ensurePrivateDirectory(directory) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let cursor = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await lstat(cursor);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await mkdir(cursor, { mode: 0o700 });
        await chmod(cursor, 0o700).catch((chmodError) => { if (chmodError?.code !== 'EPERM') throw chmodError; });
      } catch (mkdirError) {
        // Another writer may create the shared state directory after our lstat.
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      stat = await lstat(cursor);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError('Symlink or non-directory observation store parent refused');
  }
  const directoryStat = await lstat(absolute);
  if ((directoryStat.mode & 0o077) !== 0) throw new TypeError('Observation database directory must be private (0700)');
  return absolute;
}

async function assertNoSidecars(databasePath) {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try { await lstat(databasePath + suffix); throw new TypeError('Observation database has recovery sidecars; refusing to modify it'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function pragma(db, name) {
  const rows = db.exec(`PRAGMA ${name}`);
  return rows[0]?.values?.[0]?.[0] ?? 0;
}

function tableInfo(db) {
  const rows = db.exec('PRAGMA table_info(runs)');
  return rows[0]?.values ?? [];
}

function validateSchema(db, { allowEmpty = false } = {}) {
  const version = Number(pragma(db, 'user_version'));
  const appId = Number(pragma(db, 'application_id'));
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? [];
  if (version === 0 && appId === 0 && tables.length === 0 && allowEmpty) return { empty: true };
  if (version !== USER_VERSION || appId !== APPLICATION_ID) throw new TypeError('Existing database is not a supported observation store');
  const integrity = db.exec('PRAGMA integrity_check')[0]?.values?.[0]?.[0];
  if (integrity !== 'ok') throw new TypeError('Observation database integrity check failed');
  const columns = tableInfo(db);
  const expected = [
    ['run_id', 'TEXT', 0, 1], ['scope_key', 'TEXT', 1, 0],
    ['schema_version', 'INTEGER', 1, 0], ['report_json', 'TEXT', 1, 0],
  ];
  if (tables.length !== 1 || tables[0][0] !== 'runs' || columns.length !== expected.length || columns.some((row, index) => {
    const [name, type, notNull, pk] = expected[index];
    return row[1] !== name || String(row[2]).toUpperCase() !== type || Number(row[3]) !== notNull || Number(row[5]) !== pk;
  })) throw new TypeError('Observation database runs schema is invalid');
  const createSql = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='runs'")[0]?.values?.[0]?.[0] ?? '';
  if (!/CHECK\s*\(\s*schema_version\s*=\s*1\s*\)/iu.test(createSql)) throw new TypeError('Observation database runs schema constraint is invalid');
  for (const [schemaVersion] of db.exec('SELECT DISTINCT schema_version FROM runs')[0]?.values ?? []) {
    if (Number(schemaVersion) !== USER_VERSION) throw new TypeError('Observation database contains an unsupported run schema');
  }
  return { empty: false };
}

function validateBytes(SQL, bytes) {
  const check = new SQL.Database(bytes);
  try {
    validateSchema(check);
    return check;
  } catch (error) { check.close(); throw error; }
}

function resultRows(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally { statement.free(); }
}

export function runScopeKey(run) {
  const scope = {
    project_key: run.project_key,
    root_session: run.root_session,
    turn: run.turn ?? null,
    expectation: run.expectation,
    change_id: run.sdd?.change_id ?? null,
    members: run.members ?? null,
  };
  return digest(legacyJson(scope, { sortKeys: true }));
}

export class StoreSession {
  constructor(SQL, database, databasePath) {
    this.SQL = SQL;
    this.database = database;
    this.databasePath = databasePath;
    this.closed = false;
  }

  load(runId) {
    const row = resultRows(this.database, 'SELECT report_json FROM runs WHERE run_id = ?', [runId])[0];
    if (!row) throw new TypeError('Run not found');
    return parseLosslessJson(row.report_json);
  }

  allRuns() {
    return resultRows(this.database, 'SELECT report_json FROM runs ORDER BY run_id').map((row) => parseLosslessJson(row.report_json));
  }

  save(runId, run) {
    if (!identifier(runId)) throw new TypeError('Run ID must be a short ASCII identifier');
    const scopeKey = runScopeKey(run);
    const old = resultRows(this.database, 'SELECT scope_key FROM runs WHERE run_id = ?', [runId])[0];
    if (old && old.scope_key !== scopeKey) throw new TypeError('Run ID already belongs to a different scope/expectation; use a new ID');
    const data = { ...run, run_id: runId };
    const reportJson = legacyJson(data, { ensureAscii: false });
    const db = this.database;
    db.run('BEGIN IMMEDIATE');
    try {
      db.run(`INSERT INTO runs (run_id, scope_key, schema_version, report_json) VALUES (?, ?, 1, ?)
        ON CONFLICT(run_id) DO UPDATE SET report_json=excluded.report_json`, [runId, scopeKey, reportJson]);
      db.run('COMMIT');
    } catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    this.publish(runId);
    return data;
  }

  publish(runId) {
    const bytes = Buffer.from(this.database.export());
    const check = validateBytes(this.SQL, bytes);
    try {
      const rows = resultRows(check, 'SELECT run_id, scope_key, schema_version, report_json FROM runs ORDER BY run_id');
      const justSaved = rows.find((row) => row.run_id === runId);
      if (!justSaved || Number(justSaved.schema_version) !== USER_VERSION || parseLosslessJson(justSaved.report_json).run_id !== runId) throw new TypeError('Observation export validation failed');
      const expectedCount = resultRows(this.database, 'SELECT count(*) AS count FROM runs')[0].count;
      if (Number(rows.length) !== Number(expectedCount)) throw new TypeError('Observation export lost rows');
      atomicWrite(this.databasePath, bytes, { mode: 0o600 });
    } finally { check.close(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

export async function withStore(databasePath, callback, { create = true } = {}) {
  const absolute = path.resolve(String(databasePath));
  const parent = await ensurePrivateDirectory(path.dirname(absolute));
  const canonicalPath = path.join(parent, path.basename(absolute));
  return withStoreLock(parent, async () => {
    await assertNoSidecars(canonicalPath);
    let existing = null;
    try {
      const stat = await lstat(canonicalPath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError('Observation store must be a regular file');
      if ((stat.mode & 0o777) !== 0o600) throw new TypeError('Observation store permissions must be 0600');
      existing = await readFile(canonicalPath);
      if (existing.length < SQLITE_HEADER.length || !existing.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) throw new TypeError('Existing database is not an observation store');
    } catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error?.code === 'ENOENT' ? new TypeError('Observation database does not exist; collect first') : error;
    }
    const SQL = await sqlLibrary();
    let database;
    try { database = existing ? new SQL.Database(existing) : new SQL.Database(); }
    catch (error) { throw new TypeError('Observation database is corrupt or unsupported', { cause: error }); }
    let session;
    try {
      let validation;
      try { validation = validateSchema(database, { allowEmpty: true }); }
      catch (error) { throw new TypeError('Existing database is corrupt or unsupported', { cause: error }); }
      if (validation.empty) {
        database.exec(SCHEMA);
        database.run(`PRAGMA user_version=${USER_VERSION}`);
        database.run(`PRAGMA application_id=${APPLICATION_ID}`);
        const initialBytes = Buffer.from(database.export());
        const check = validateBytes(SQL, initialBytes);
        check.close();
        atomicWrite(canonicalPath, initialBytes, { mode: 0o600 });
      }
      session = new StoreSession(SQL, database, canonicalPath);
      return await callback(session);
    } finally { if (session) session.close(); else database.close(); }
  });
}
