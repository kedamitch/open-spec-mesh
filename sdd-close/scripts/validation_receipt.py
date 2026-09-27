"""Resolve the project validation entry point and verify revision-bound receipts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import os
import re
import subprocess
import tempfile

from sdd_common import inside, read_text

VALIDATION_DOC = Path('docs/08-quality/Q01-validation.md')
RECEIPT_SCHEMA = 1
PLACEHOLDERS = {'待核实', 'pending', 'tbd', 'todo', '-', '无'}


def validation_entrypoint(root):
    """Resolve one versioned Python validation entry point from Q01."""
    source = inside(root, *VALIDATION_DOC.parts)
    lines = read_text(source).splitlines()
    heading = '## Validation Entry Point'
    if lines.count(heading) != 1:
        raise ValueError('Validation config requires exactly one ## Validation Entry Point')
    start = lines.index(heading) + 1
    value = ''
    for line in lines[start:]:
        if line.startswith('## '):
            break
        if line.strip() and not value:
            value = line.strip()
    if len(value) >= 2 and value[0] == '`' and value[-1] == '`':
        value = value[1:-1].strip()
    folded = value.casefold()
    if (not value or folded in PLACEHOLDERS
            or any(marker in folded for marker in ('待核实', 'pending', 'tbd', 'todo'))):
        raise ValueError('Validation Entry Point is unresolved')
    relative = Path(value)
    if relative.is_absolute() or '..' in relative.parts or '\\' in value:
        raise ValueError('Validation Entry Point must stay inside the project')
    if relative.suffix != '.py':
        raise ValueError('Validation Entry Point must be a Python script')
    path = inside(root, *relative.parts)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Validation Entry Point does not exist: ' + value)
    return {'path': value, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def receipt_path(root, change_id):
    if not re.fullmatch(r'CHG-\d{8}-[^/\\]+', change_id):
        raise ValueError('Invalid Change id for validation receipt')
    result = subprocess.run(
        ['git', '-C', str(root), 'rev-parse', '--git-common-dir'],
        text=True, capture_output=True,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or 'Cannot locate Git metadata for validation receipt')
    base = Path(result.stdout.strip())
    if not base.is_absolute():
        base = root / base
    base = base.resolve() / 'sdd-validation'
    base.mkdir(parents=True, exist_ok=True)
    if base.is_symlink():
        raise ValueError('Validation receipt directory must not be a symlink')
    return base / f'{change_id}.json'


def write_receipt(root, change_id, receipt):
    path = receipt_path(root, change_id)
    if path.is_symlink():
        raise ValueError('Validation receipt must not be a symlink')
    fd, name = tempfile.mkstemp(prefix='.receipt-', dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)
    return path


def load_receipt(root, change_id):
    path = receipt_path(root, change_id)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Machine validation receipt required; run sdd-close/scripts/run_validation.py')
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError('Machine validation receipt is invalid') from exc
    if not isinstance(value, dict):
        raise ValueError('Machine validation receipt is invalid')
    return value


def validate_receipt(root, change_id, integrated_revision):
    """Reject stale, failed, partial, or entry-point-drifted validation records."""
    entrypoint = validation_entrypoint(root)
    receipt = load_receipt(root, change_id)
    expected = {
        'schema': RECEIPT_SCHEMA,
        'change': change_id,
        'revision': integrated_revision,
        'entrypoint': entrypoint,
        'passed': True,
        'exit_code': 0,
    }
    for key, value in expected.items():
        if receipt.get(key) != value:
            raise ValueError(f'Machine validation receipt mismatch: {key}')
    for key in ('stdout_sha256', 'stderr_sha256'):
        if not re.fullmatch(r'[0-9a-f]{64}', str(receipt.get(key, ''))):
            raise ValueError('Machine validation receipt output digest is invalid: ' + key)
    return receipt
