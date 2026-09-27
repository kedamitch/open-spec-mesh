#!/usr/bin/env python3
"""Canonical local validation entry point used by SDD close."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CHECKS = (
    ('unit-and-integration', [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests', '-v']),
    ('agent-regressions', [sys.executable, '-B', 'agents/test_validate_agents.py']),
    ('agent-config', [sys.executable, '-B', 'agents/validate_agents.py']),
    ('docs', [sys.executable, '-B', 'sdd-init/scripts/validate_docs.py', '--root', '.']),
    ('install-syntax', ['bash', '-n', 'install.sh']),
    ('install-dry-run', ['bash', 'install.sh', '--dry-run']),
)


def main():
    for name, command in CHECKS:
        print(f'== {name} ==', flush=True)
        result = subprocess.run(command, cwd=ROOT)
        if result.returncode:
            print(f'FAILED {name}: exit={result.returncode}', file=sys.stderr)
            return result.returncode
    print('ALL REQUIRED LOCAL CHECKS PASSED')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
