"""Optional strict leaf fallback: run/resume an isolated Codex process with delegation disabled.

Native Multi-Agent V2 is the default workflow. This helper is only for tasks
that explicitly need a separate process with V1/V2 agent features disabled.
It preserves the configured provider/auth and never copies credentials.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
import uuid

LEAVES = ('worker', 'reviewer', 'explorer', 'librarian')


def role_path(role):
    if role not in LEAVES:
        raise ValueError('Only leaf roles are permitted')
    package = Path(__file__).resolve().parents[2]
    for root in (package, package.parent):
        path = root / 'agents' / (role + '.toml')
        if path.is_file(): return path
    raise ValueError('Installed role file missing')


def command(binary, role_file, project, resume=None):
    data = tomllib.loads(Path(role_file).read_text(encoding='utf-8'))
    if data.get('name') not in LEAVES:
        raise ValueError('Architect/Main cannot use the leaf launcher')
    project = Path(project).resolve()
    if not project.is_dir(): raise ValueError('Project directory missing')
    if resume: uuid.UUID(resume)  # exact thread ID, never implicit --last
    overrides = {key:data[key] for key in ('model', 'model_reasoning_effort', 'developer_instructions', 'sandbox_mode')}
    overrides.update({'agents.enabled': False,
                      'features.multi_agent': False, 'features.multi_agent_v2': False})
    args = [binary, '-C', str(project)]
    for key, value in overrides.items(): args += ['-c', key + '=' + json.dumps(value, ensure_ascii=False)]
    args += ['exec']
    if resume: args += ['resume', resume]
    args += ['--json', '--skip-git-repo-check', '-']
    return args


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=LEAVES)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--prompt-file', type=Path, required=True)
    parser.add_argument('--resume', help='Exact prior leaf thread ID; use the same role/worktree')
    parser.add_argument('--timeout', type=int, default=900)
    args = parser.parse_args()
    try:
        binary = shutil.which('codex')
        if not binary: raise ValueError('Codex CLI not installed')
        if args.timeout < 1: raise ValueError('Timeout must be positive')
        text = args.prompt_file.read_text(encoding='utf-8')
        if not text.strip(): raise ValueError('Task prompt is empty')
        result = subprocess.run(command(binary, role_path(args.role), args.root, args.resume),
                                input=text, text=True, timeout=args.timeout, cwd=args.root)
        raise SystemExit(result.returncode)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, str(error) + '\n')

if __name__ == '__main__': main()
