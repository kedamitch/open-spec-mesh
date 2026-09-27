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

from observation.collect import collect, scan_runs
from observation.diagnose import diagnose, markdown, summary, group_runs
from observation.store import open_store, save, load, all_runs
from observation.trace import ROLES


def main(argv=None):
    home = Path(os.environ.get('CODEX_HOME', str(Path.home()/'.codex')))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=home/'sdd-observe/observations.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    ingest = sub.add_parser('collect', help='Read one existing root rollout and its linked descendants')
    ingest.add_argument('--run', required=True)
    ingest.add_argument('--root', type=Path, required=True)
    ingest.add_argument('--session-file', type=Path, required=True)
    ingest.add_argument('--sessions-dir', type=Path, help='Optional local session index; only linked children are imported')
    ingest.add_argument('--rules-root', type=Path, default=home, help='Codex Home or package source root; inventory only')
    ingest.add_argument('--turn', help='Required when the root contains multiple user turns')
    ingest.add_argument('--change', help='Explicit CHG-YYYYMMDD-slug; never associates by cwd alone')
    ingest.add_argument('--expected-mode', choices=('unknown', 'quick', 'sdd'), default='unknown')
    ingest.add_argument('--expect-role', action='append', choices=sorted(ROLES-{'main'}), default=[])
    scan = sub.add_parser('scan', help='Batch existing turns; no extra Agent messages or per-task instrumentation')
    scan.add_argument('--root', type=Path, required=True)
    scan.add_argument('--sessions-dir', type=Path, default=home/'sessions')
    scan.add_argument('--rules-root', type=Path, default=home)
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
            if not project.is_dir():
                raise ValueError('Project does not exist')
            db_path = args.db.expanduser().resolve()
            if db_path.is_relative_to(project):
                raise ValueError('Keep observation DB outside the project/Git tree')
            if args.command == 'scan':
                runs, skipped = scan_runs(project, args.rules_root.expanduser(), args.sessions_dir.expanduser(), args.since, args.max_runs)
                with closing(open_store(args.db)) as db:
                    for key, run in runs:
                        save(db, key, diagnose(run))
                print(json.dumps({'runs': [key for key, _ in runs], 'index_skipped': skipped, 'diagnostic_model_calls': 0}))
            else:
                run = diagnose(collect(project, args.rules_root.expanduser(), args.session_file.expanduser(),
                                       args.sessions_dir.expanduser() if args.sessions_dir else None,
                                       args.turn, args.change, args.expected_mode, args.expect_role))
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
