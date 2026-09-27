#!/usr/bin/env python3
"""Run the project's single validation entry point and record a revision-bound receipt."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE/'sdd-init/scripts'), str(PACKAGE/'sdd-change/scripts')]
from sdd_common import active_change, root_path
from workflow import git, revision
from validation_receipt import RECEIPT_SCHEMA, validation_entrypoint, write_receipt


def dirty_paths(root):
    tracked = set(git(root, 'diff', '--name-only', '-z', 'HEAD').split('\0'))
    untracked = set(git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'))
    return (tracked | untracked) - {''}


def change_snapshot(change):
    """Detect validation commands that mutate SDD artifacts while they run."""
    digest = hashlib.sha256()
    for path in sorted(change.rglob('*')):
        if path.is_symlink():
            raise ValueError('Active Change must not contain symlinks during validation')
        if not path.is_file():
            continue
        relative = path.relative_to(change).as_posix().encode()
        digest.update(len(relative).to_bytes(8, 'big'))
        digest.update(relative)
        data = path.read_bytes()
        digest.update(len(data).to_bytes(8, 'big'))
        digest.update(data)
    return digest.hexdigest()


def run_validation(root, change_id, revision_value='HEAD'):
    change, _, _ = active_change(root, change_id)
    sha = revision(root, revision_value)
    if revision(root, 'HEAD') != sha:
        raise ValueError('Validation revision must be the current checkout HEAD')

    allowed_prefix = change.relative_to(root).as_posix().rstrip('/') + '/'
    before_dirty = dirty_paths(root)
    entrypoint = validation_entrypoint(root)
    tracked = git(root, 'ls-files', '--error-unmatch', '--', entrypoint['path'])
    if tracked != entrypoint['path'] or entrypoint['path'] in before_dirty:
        raise ValueError('Validation Entry Point must be tracked and committed at the validated revision')
    unexpected = sorted(path for path in before_dirty if not path.startswith(allowed_prefix))
    if unexpected:
        raise ValueError(
            'Commit or preserve non-Change edits before integration validation: '
            + ', '.join(unexpected)
        )
    before_change = change_snapshot(change)

    receipt = {
        'schema': RECEIPT_SCHEMA,
        'change': change_id,
        'revision': sha,
        'entrypoint': entrypoint,
        'passed': False,
        'exit_code': None,
        'stdout_sha256': hashlib.sha256(b'').hexdigest(),
        'stderr_sha256': hashlib.sha256(b'').hexdigest(),
    }
    write_receipt(root, change_id, receipt)

    script = root / entrypoint['path']
    completed = subprocess.run(
        [sys.executable, str(script)],
        cwd=root,
        text=True,
        capture_output=True,
    )
    output = {
        'exit_code': completed.returncode,
        'stdout_sha256': hashlib.sha256(completed.stdout.encode()).hexdigest(),
        'stderr_sha256': hashlib.sha256(completed.stderr.encode()).hexdigest(),
    }
    stable = (
        revision(root, 'HEAD') == sha
        and change_snapshot(change) == before_change
        and not any(path for path in dirty_paths(root) if not path.startswith(allowed_prefix))
    )
    receipt.update(passed=completed.returncode == 0 and stable, **output)
    write_receipt(root, change_id, receipt)
    if completed.returncode:
        detail = (completed.stderr or completed.stdout).strip().splitlines()[-8:]
        raise ValueError(
            f'Integration validation failed with exit code {completed.returncode}'
            + (': ' + ' | '.join(detail) if detail else '')
        )
    if not stable:
        raise ValueError('Validation command changed the validated revision or project artifacts')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('change_id')
    parser.add_argument('--root', default=str(Path.cwd()))
    parser.add_argument('--revision', default='HEAD')
    args = parser.parse_args()
    try:
        print(json.dumps(
            run_validation(root_path(args.root), args.change_id, args.revision),
            ensure_ascii=False,
            indent=2,
        ))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
