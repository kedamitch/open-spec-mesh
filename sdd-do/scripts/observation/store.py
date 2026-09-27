"""Local SQLite, rebuildable per-run snapshots, no raw trace payload storage."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3

from .trace import digest, identifier

APPLICATION_ID = 0x5344444F

SCHEMA = '''
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    scope_key TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    report_json TEXT NOT NULL
);
'''


def open_store(path: Path):
    path = Path(os.path.abspath(path.expanduser()))
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Symlink observation store refused')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # O_EXCL/O_NOFOLLOW prevent silently replacing/following an existing file.
    if not path.exists():
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        os.close(fd)
    if not path.is_file():
        raise ValueError('Observation store must be a regular file')
    if path.stat().st_mode & 0o077:
        raise ValueError('Observation store permissions must be 0600')
    db = sqlite3.connect(path, timeout=5)
    try:
        version = db.execute('PRAGMA user_version').fetchone()[0]
        if version not in (0, 1):
            raise ValueError('Unsupported observation database version')
        app_id = db.execute('PRAGMA application_id').fetchone()[0]
        tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        if (version == 1 and app_id != APPLICATION_ID) or (version == 0 and tables):
            raise ValueError('Existing database is not an observation store')
        db.execute('PRAGMA journal_mode=DELETE')
        db.executescript(SCHEMA)
        db.execute('PRAGMA user_version=1')
        db.execute(f'PRAGMA application_id={APPLICATION_ID}')
        return db
    except BaseException:
        db.close()
        raise


def save(db, run_id: str, run: dict) -> dict:
    if not identifier(run_id):
        raise ValueError('Run ID must be a short ASCII identifier')
    scope = {k: run[k] for k in ('project_key', 'root_session', 'turn', 'expectation')}
    scope['change_id'] = run['sdd'].get('change_id')
    scope['members'] = run.get('members')
    key = digest(json.dumps(scope, sort_keys=True))
    data = dict(run, run_id=run_id)
    with db:
        old = db.execute('SELECT scope_key FROM runs WHERE run_id=?', (run_id,)).fetchone()
        if old and old[0] != key:
            raise ValueError('Run ID already belongs to a different scope/expectation; use a new ID')
        db.execute('INSERT INTO runs VALUES (?, ?, 1, ?) ON CONFLICT(run_id) DO UPDATE SET report_json=excluded.report_json',
                   (run_id, key, json.dumps(data, ensure_ascii=False)))
    return data


def load(db, run_id: str) -> dict:
    row = db.execute('SELECT report_json FROM runs WHERE run_id=?', (run_id,)).fetchone()
    if not row:
        raise ValueError('Run not found')
    return json.loads(row[0])


def all_runs(db) -> list[dict]:
    return [json.loads(row[0]) for row in db.execute('SELECT report_json FROM runs ORDER BY run_id')]
