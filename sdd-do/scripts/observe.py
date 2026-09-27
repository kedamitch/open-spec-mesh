#!/usr/bin/env python3
"""Offline script-only diagnostics. Never invokes Codex, LLMs or any network API."""
from __future__ import annotations

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys

sys.dont_write_bytecode = True

from observation.collect import collect, collect_host_snapshot, scan_runs
from observation.diagnose import diagnose, markdown, summary, group_runs
from observation.store import open_store, save, load, all_runs
from observation.trace import ROLES


def runtime_home(host):
    home = Path.home()
    if host == 'codex':
        return Path(os.environ.get('CODEX_HOME', str(home/'.codex')))
    if host == 'opencode':
        return Path(os.environ.get('OPENCODE_CONFIG_DIR', str(home/'.config/opencode')))
    if host == 'claude':
        return Path(os.environ.get('CLAUDE_CONFIG_DIR', str(home/'.claude')))
    raise ValueError('Unknown host')


def state_home():
    if os.environ.get('OPEN_SPEC_MESH_STATE_HOME'):
        return Path(os.environ['OPEN_SPEC_MESH_STATE_HOME']).expanduser()
    base = Path(os.environ.get('XDG_STATE_HOME', str(Path.home()/'.local/state'))).expanduser()
    return base/'open-spec-mesh'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', choices=('codex','opencode','claude'),
                        default=os.environ.get('OPEN_SPEC_MESH_HOST','codex'))
    parser.add_argument('--db', type=Path, default=state_home()/'observations.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    ingest = sub.add_parser('collect', help='Read one existing root rollout and its linked descendants')
    ingest.add_argument('--run', required=True)
    ingest.add_argument('--root', type=Path, required=True)
    ingest.add_argument('--session-file', type=Path)
    ingest.add_argument('--sessions-dir', type=Path, help='Optional local session index; only linked children are imported')
    ingest.add_argument('--rules-root', type=Path, help='Host home or package source root; inventory only')
    ingest.add_argument('--turn', help='Required when the root contains multiple user turns')
    ingest.add_argument('--change', help='Explicit CHG-YYYYMMDD-slug; never associates by cwd alone')
    ingest.add_argument('--expected-mode', choices=('unknown', 'quick', 'sdd'), default='unknown')
    ingest.add_argument('--expect-role', action='append', choices=sorted(ROLES-{'main'}), default=[])
    scan = sub.add_parser('scan', help='Batch existing turns; no extra Agent messages or per-task instrumentation')
    scan.add_argument('--root', type=Path, required=True)
    scan.add_argument('--sessions-dir', type=Path)
    scan.add_argument('--rules-root', type=Path)
    scan.add_argument('--since', help='Only turns starting on/after YYYY-MM-DD (UTC)')
    scan.add_argument('--max-runs', type=int, default=100)
    report = sub.add_parser('report', help='Render a stored run')
    report.add_argument('--run', required=True)
    report.add_argument('--format', choices=('md', 'json'), default='md')
    group = sub.add_parser('group', help='Explicitly join slices of the same user demand, without double-counting')
    group.add_argument('--run', required=True)
    group.add_argument('--members', nargs='+', required=True)
    sub.add_parser('summary', help='Group stored runs by expected mode and configuration fingerprint')
    args = parser.parse_args(argv)
    try:
        if args.command in {'collect', 'scan'}:
            project = args.root.expanduser().resolve()
            home = runtime_home(args.host)
            rules_root = (args.rules_root or home).expanduser()
            if not project.is_dir():
                raise ValueError('Project does not exist')
            db_path = args.db.expanduser().resolve()
            if db_path.is_relative_to(project):
                raise ValueError('Keep observation DB outside the project/Git tree')
            if args.command == 'scan':
                if args.host != 'codex':
                    raise ValueError('Native trace scan is unsupported for ' + args.host + '; use collect for artifact snapshot')
                sessions_dir = (args.sessions_dir or home/'sessions').expanduser()
                runs, skipped = scan_runs(project, rules_root, sessions_dir, args.since, args.max_runs)
                with closing(open_store(args.db)) as db:
                    for key, run in runs:
                        save(db, key, diagnose(run))
                print(json.dumps({'runs': [key for key, _ in runs], 'index_skipped': skipped, 'diagnostic_model_calls': 0}))
            else:
                if args.host == 'codex':
                    if not args.session_file:
                        raise ValueError('--session-file is required for codex trace collection')
                    raw = collect(
                        project, rules_root, args.session_file.expanduser(),
                        args.sessions_dir.expanduser() if args.sessions_dir else None,
                        args.turn, args.change, args.expected_mode, args.expect_role)
                else:
                    if args.session_file or args.sessions_dir or args.turn:
                        raise ValueError('Private session trace input is unsupported for ' + args.host)
                    raw = collect_host_snapshot(
                        project, rules_root, args.host, args.change,
                        args.expected_mode, args.expect_role)
                run = diagnose(raw)
                with closing(open_store(args.db)) as db:
                    saved = save(db, args.run, run)
                print(json.dumps({'run': args.run, 'findings': len(saved['findings']),
                                  'coverage': saved['coverage'], 'diagnostic_model_calls': 0}, ensure_ascii=False))
        else:
            if not args.db.expanduser().is_file():
                raise ValueError('Observation database does not exist; collect first')
            with closing(open_store(args.db)) as db:
                if args.command == 'group':
                    run = save(db, args.run, group_runs([load(db, key) for key in args.members]))
                    print(json.dumps({'run': args.run, 'members': run['members'], 'diagnostic_model_calls': 0}))
                elif args.command == 'summary':
                    print(summary(all_runs(db)))
                else:
                    run = load(db, args.run)
                    print(json.dumps(run, ensure_ascii=False, indent=2) if args.format == 'json' else markdown(run))
        return 0
    except (OSError, ValueError, sqlite3.Error, KeyError) as exc:
        # Never echo arbitrary source text or raw tool results in error messages.
        parser.exit(1, f'observe: {type(exc).__name__}: {str(exc)[:200]}\n')


if __name__ == '__main__':
    main()
