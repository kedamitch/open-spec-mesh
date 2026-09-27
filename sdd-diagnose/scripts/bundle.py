#!/usr/bin/env python3
"""One-shot, offline diagnostic bundle. No model, network, subprocess or source writes."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import uuid
import zipfile

sys.dont_write_bytecode = True
VERSION = 1
MAX_FILES = 10000
MAX_ROOTS = 200
MAX_TRACES = 300
MAX_TRACE_BYTES = 128 * 1024 * 1024
MAX_OUTPUT = 32 * 1024 * 1024
MAX_HEADER = 8 * 1024 * 1024
ROLES = ('architect', 'worker', 'reviewer', 'explorer', 'librarian')


def sha(value: str | bytes) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def safe_path(value: Path) -> Path:
    path = value.expanduser().absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('symlink_path_refused')
    return path.resolve()


def project_root(value: Path) -> Path:
    path = safe_path(value)
    if not path.is_dir():
        raise ValueError('project_missing')
    for parent in (path, *path.parents):
        if (parent / '.git').exists():
            path = parent
            break
    if path in (Path(path.anchor), Path.home().resolve()):
        raise ValueError('select_a_project_not_home')
    return path


def load_engine() -> SimpleNamespace:
    # Source: <repo>/sdd-do/scripts. Installed: <CODEX_HOME>/skills/sdd-do/scripts.
    scripts = Path(__file__).resolve().parents[2] / 'sdd-do' / 'scripts'
    if not (scripts / 'observation' / 'collect.py').is_file():
        raise ValueError('observer_missing_reinstall_package')
    sys.path.insert(0, str(scripts))
    from observation import collect, diagnose, trace
    return SimpleNamespace(collect=collect, diagnose=diagnose, trace=trace, scripts=scripts)


def discover(project: Path, directory: Path) -> tuple[dict, list, Counter]:
    """Index metadata once. Never follow links, read other projects' bodies, or guess parents."""
    issues = Counter()
    indexed, roots, duplicates = {}, [], set()
    if not directory.exists():
        return indexed, roots, Counter(sessions_missing=1)
    directory = safe_path(directory)
    if not directory.is_dir():
        raise ValueError('sessions_not_directory')
    seen, header_bytes = 0, 0
    for folder, dirs, files in os.walk(directory, followlinks=False):
        for name in list(dirs):
            if (Path(folder) / name).is_symlink():
                dirs.remove(name)
                issues['symlink_skipped'] += 1
        dirs.sort()
        for name in sorted(files):
            if not name.endswith('.jsonl'):
                continue
            seen += 1
            if seen > MAX_FILES:
                issues['file_index_limit'] += 1
                break
            path = Path(folder) / name
            try:
                safe_path(path)
                with path.open('rb') as stream:
                    header = stream.readline(MAX_HEADER + 1)
                header_bytes += len(header)
                if header_bytes > 32 * 1024 * 1024:
                    issues['header_bytes_limit'] += 1
                    break
                if len(header) > MAX_HEADER:
                    raise ValueError('header_limit')
                record = json.loads(header)
                if not isinstance(record, dict) or record.get('type') != 'session_meta':
                    issues['unsupported_header'] += 1
                    continue
                meta = record.get('payload')
                if not isinstance(meta, dict):
                    raise ValueError('metadata_shape')
                sid = meta.get('id')
                if not isinstance(sid, str) or not sid or len(sid) > 128:
                    raise ValueError('session_identity')
                if sid in indexed or sid in duplicates:
                    indexed.pop(sid, None)
                    duplicates.add(sid)
                    issues['duplicate_session'] += 1
                    continue
                indexed[sid] = path
                cwd, source = meta.get('cwd'), meta.get('source')
                if not isinstance(cwd, str) or not Path(cwd).is_absolute():
                    continue
                if not Path(cwd).resolve().is_relative_to(project):
                    continue
                if meta.get('parent_thread_id') or meta.get('agent_role') in ROLES:
                    continue
                if isinstance(source, dict) and 'subagent' in source:
                    continue
                roots.append((path.stat().st_mtime_ns, sid, path))
            except (OSError, ValueError, UnicodeError, TypeError, RecursionError):
                issues['header_unreadable'] += 1
        if seen > MAX_FILES or issues.get('header_bytes_limit'):
            break
    roots = sorted((r for r in roots if r[1] not in duplicates), reverse=True)
    if len(roots) > MAX_ROOTS:
        issues['root_index_limit'] = len(roots) - MAX_ROOTS
    return indexed, roots[:MAX_ROOTS], issues


def collect_recent(project, home, sessions_dir, rules_root, days=7, limit=20,
                   expected_mode='unknown', expected_roles=(), *, engine=None, now=None):
    """Reuse the existing parser, scope selector, SDD adapter and deterministic rules."""
    if not 1 <= days <= 90 or not 1 <= limit <= 100:
        raise ValueError('invalid_window_or_limit')
    engine = engine or load_engine()
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=days)).isoformat()
    indexed, roots, issues = discover(project, sessions_dir)
    cache, failed = {}, set()
    trace_bytes = 0

    def parsed(sid):
        nonlocal trace_bytes
        if sid in failed:
            return None
        if sid not in cache:
            if len(cache) + len(failed) >= MAX_TRACES:
                issues['trace_limit'] += 1
                return None
            try:
                size = indexed[sid].stat().st_size
                if trace_bytes + size > MAX_TRACE_BYTES:
                    issues['trace_bytes_limit'] += 1
                    return None
                trace_bytes += size
                result = engine.trace.read_rollout(indexed[sid])
                if result['id'] != sid:
                    raise ValueError('session_identity_changed')
                cache[sid] = result
            except (OSError, ValueError, UnicodeError, KeyError, RecursionError):
                failed.add(sid)
                issues['trace_unreadable'] += 1
                return None
        return cache[sid]

    slices = []
    for _, sid, _ in roots:
        trace = parsed(sid)
        if trace is None:
            continue
        turns = trace['turns'] or [None]
        for turn in turns:
            starts = [e['at'] for e in trace['events']
                      if e.get('turn') == turn and e['kind'] == 'turn.start' and e.get('at')]
            if not starts:
                issues['turn_timestamp_missing'] += 1
                continue
            if starts[0] > now.isoformat():
                issues['future_turn_timestamp'] += 1
                continue
            if starts[0] >= cutoff:
                slices.append((starts[0], sid, turn))
    slices.sort(key=lambda item: (item[0], item[1], item[2] or ''), reverse=True)
    omitted = max(0, len(slices) - limit)
    selected = slices[:limit]
    snapshots = engine.collect.snapshot(project, rules_root)
    skill_file = Path(__file__).resolve().parents[1] / 'SKILL.md'
    skill_text = engine.collect.file_text(skill_file)
    snapshots.append({'path': 'collector/sdd-diagnose/SKILL.md', 'status': 'present',
                      'digest': sha(skill_text), 'bytes': len(skill_text.encode()),
                      'evidence': 'collector_version_not_historical_loading'})
    fingerprint = sha(json.dumps([(x['path'], x.get('digest')) for x in snapshots], sort_keys=True))
    runs = []
    for _, sid, turn in selected:
        trace, candidates, visited = cache[sid], [], {sid}
        try:
            while True:
                sessions, events, coverage = engine.collect.select(trace, candidates, turn)
                children = {e.get('fact', {}).get('child') for e in events
                            if e.get('status') == 'success' and e.get('fact', {}).get('kind')
                            in {'agent.spawn', 'agent.resume', 'agent.message'}} - {None}
                pending = sorted(children - visited)
                if not pending:
                    break
                for child in pending:
                    visited.add(child)
                    if child in indexed:
                        result = parsed(child)
                        if result is not None:
                            candidates.append(result)
            changes = {e.get('fact', {}).get('change_id') for e in events
                       if e.get('status') == 'success'} - {None}
            change = next(iter(changes)) if len(changes) == 1 else None
            if issues:
                coverage.append('bundle_input_partial')
            run = {
                'schema': 1, 'collected_at': now.isoformat(), 'project_key': sha(str(project)),
                'root_session': trace['id'], 'turn': turn,
                'expectation': {'mode': expected_mode, 'roles': sorted(set(expected_roles)),
                                'source': 'operator_not_model'},
                'sessions': sessions, 'events': events,
                'coverage': {'status': 'partial' if coverage else 'observed',
                             'issues': sorted(set(coverage))},
                'snapshots': snapshots, 'configuration_fingerprint': fingerprint,
                'configuration_basis': 'current_inventory_not_proven_active',
                'sdd': engine.collect.sdd_artifacts(project, change),
            }
            run = engine.diagnose.diagnose(run)
            run['run_id'] = 'run-' + sha(json.dumps([str(project), sid, turn]))[:20]
            runs.append(run)
        except (OSError, ValueError, KeyError, TypeError, UnicodeError, RecursionError):
            # Keep scope counts and the missing slice visible; never print source payloads.
            issues['slice_collect_failed'] += 1
    if issues:
        for run in runs:
            run['coverage']['status'] = 'partial'
            run['coverage']['issues'] = sorted(set(run['coverage']['issues']) | {'bundle_input_partial'})
    selection = {'days': days, 'limit': limit, 'eligible_slices': len(slices),
                 'selected_slices': len(selected), 'exported_slices': len(runs),
                 'omitted_older_slices': omitted, 'issues': dict(sorted(issues.items())),
                 'scope': 'recent_project_root_turns_not_a_single_task',
                 'sessions_scope': 'sessions_directory_only',
                 'expected_mode': expected_mode, 'expected_roles': sorted(set(expected_roles))}
    return runs, snapshots, selection, engine


def encode(data) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()


def write_bundle(project, home, runs, snapshots, selection, engine, output=None, *, now=None):
    now = now or datetime.now(timezone.utc)
    status = ('no_sessions' if not runs else
              'partial' if selection['issues'] or selection['omitted_older_slices']
              or any(r['coverage']['status'] != 'observed' for r in runs) else 'ready')
    directory = home / 'sdd-observe' / 'bundles'
    filename = f'sdd-diagnose-{now:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}.zip'
    target = safe_path(output or directory / filename)
    if target.suffix.lower() != '.zip' or target.exists():
        raise ValueError('output_must_be_new_zip')
    if target.is_relative_to(project) or any((p / '.git').exists() for p in target.parents):
        raise ValueError('keep_bundle_outside_project_and_git')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    safe_path(target.parent)
    files = {
        'summary.md': ('# 诊断数据包\n\n'
                       f'状态：{status}。收集 {len(runs)} 个执行片段；未自动合并为同一个需求。\n\n'
                       '数据范围见 manifest.json；无记录或覆盖不足不表示流程正确或错误。\n\n'
                       + (engine.diagnose.summary(runs) if runs else
                          '未找到可用执行片段。请在发生问题的项目内调用技能，并确认本地保留了 Codex sessions。\n')
                       ).encode(),
        'inventory.json': encode(snapshots),
        'README.md': ('# 诊断包说明\n\n先看 summary.md，再看 reports/ 中的逐片段报告。\n\n'
                      '此包仅含既有离线观测器筛选的元数据、固定规则结论与指纹；'
                      '不复制原始对话、思维链、命令、工具输出、源码、配置正文或凭据。'
                      '仍含执行时间和关联 ID，请按需私下分享，不会自动上传。\n\n'
                      'inventory.json 是采集时快照，不证明历史规则加载或模型动机。'
                      'unknown 不是失败；未提供期望模式/角色时，不猜测是否应使用 SDD/Explorer。'
                      '多个片段未推测为同一任务；报告可有进行中的片段。\n\n'
                      'manifest.json 列出范围、缺失项和每个文件的 SHA-256。'
                      '导出与检查不调用模型、网络、Codex 或子进程。\n').encode(),
    }
    for n, run in enumerate(runs, 1):
        files[f'reports/{n:03d}.md'] = engine.diagnose.markdown(run).encode()
        files[f'data/{n:03d}.json'] = encode(run)
    if sum(map(len, files.values())) > MAX_OUTPUT:
        raise ValueError('bundle_size_limit_reduce_limit')
    manifest = {'schema': VERSION, 'created_at': now.isoformat(), 'status': status,
                'diagnostic_model_calls': 0, 'project_key': sha(str(project)),
                'selection': selection, 'files': {k: sha(v) for k, v in sorted(files.items())}}
    files['manifest.json'] = encode(manifest)
    fd, temp_name = tempfile.mkstemp(prefix='.sdd-bundle-', dir=target.parent)
    temp = Path(temp_name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for name, data in sorted(files.items()):
                    info = zipfile.ZipInfo(name, now.timetuple()[:6])
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100600 << 16
                    archive.writestr(info, data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, 0o600)
        os.link(temp, target)  # Atomic publication, never replace an existing file.
    finally:
        temp.unlink(missing_ok=True)
    return {'bundle': str(target), 'status': status, 'runs': len(runs),
            'diagnostic_model_calls': 0}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--limit', type=int, default=20)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--sessions-dir', type=Path)
    parser.add_argument('--rules-root', type=Path)
    parser.add_argument('--expected-mode', choices=('unknown', 'quick', 'sdd'), default='unknown')
    parser.add_argument('--expect-role', action='append', choices=ROLES, default=[])
    args = parser.parse_args(argv)
    try:
        project = project_root(args.root)
        home = safe_path(Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))))
        sessions = safe_path(args.sessions_dir or home / 'sessions')
        package = Path(__file__).resolve().parents[2]
        rules = safe_path(args.rules_root or (package if (package/'config.toml').is_file() else home))
        runs, snapshots, selection, engine = collect_recent(
            project, home, sessions, rules, args.days, args.limit,
            args.expected_mode, args.expect_role)
        result = write_bundle(project, home, runs, snapshots, selection, engine, args.output)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, ImportError, UnicodeError) as error:
        # Error class only: source exception text may contain private paths or values.
        print(f'sdd-diagnose: {type(error).__name__}; no successful bundle reported. '
              'Check observer installation, project/session paths and private output permissions.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
