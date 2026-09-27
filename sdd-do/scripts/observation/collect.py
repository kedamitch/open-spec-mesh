"""Scope one run, join explicitly identified SDD artifacts, and fingerprint configuration."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import tomllib

from .trace import SKILLS, ROLES, digest, identifier, instant, policy_signal, read_rollout


def file_text(path: Path, limit=8 * 1024 * 1024) -> str:
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('Expected a bounded, regular non-symlink input file')
    return path.read_text(encoding='utf-8')


def frontmatter(text: str) -> dict:
    if not text.startswith('---\n'):
        return {}
    values = {}
    for line in text.split('\n', 1)[1].splitlines():
        if line == '---':
            return values
        key, sep, value = line.partition(':')
        if not sep or key in values:
            raise ValueError('Invalid SDD frontmatter')
        values[key.strip()] = value.strip()
    raise ValueError('Unclosed SDD frontmatter')


def safe_child(parent: Path, name: str) -> Path:
    if not isinstance(name, str) or Path(name).name != name or name in {'.', '..'} or '\\' in name:
        raise ValueError('Invalid SDD direct-child mapping')
    child = parent / name
    if child.is_symlink():
        raise ValueError('Symlink SDD artifact refused')
    return child


def safe_relative(parent: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or '\\' in name:
        raise ValueError('Invalid SDD relative mapping')
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts or any(part in {'', '.'} for part in relative.parts):
        raise ValueError('Invalid SDD relative mapping')
    child = parent.joinpath(*relative.parts)
    cursor = parent
    for part in relative.parts:
        cursor /= part
        if cursor.is_symlink():
            raise ValueError('Symlink SDD artifact refused')
    return child


def snapshot(project: Path, rules_root: Path) -> list[dict]:
    """Current inventory, NOT proof that these files were loaded in the recorded run."""
    items = []
    files = []
    for label, directory in [('rules', rules_root), ('project', project)]:
        for name in ('AGENTS.md', 'AGENTS.override.md'):
            path = directory / name
            if path.exists() or path.is_symlink():
                files.append((label + '/' + name, path))
    for role in sorted(ROLES - {'main'}):
        files.append(('rules/agents/' + role + '.toml', rules_root/'agents'/f'{role}.toml'))
    # Installed layout and source layout; record collision/missing rather than choosing a hidden winner.
    for base, label in [(rules_root/'skills', 'rules/skills'), (rules_root, 'source'),
                        (project/'.agents/skills', 'project/.agents/skills')]:
        for skill in sorted(SKILLS):
            path = base/skill/'SKILL.md'
            if path.exists() or (base == rules_root/'skills' and not (rules_root/skill/'SKILL.md').exists()):
                files.append((label + '/' + skill + '/SKILL.md', path))
            if (base/skill/'references').is_dir() and not (base/skill/'references').is_symlink():
                files += [(label+'/'+skill+'/references/'+p.name, p)
                          for p in sorted((base/skill/'references').glob('*.md'))]
    for label, path in files:
        item = {'path': label, 'evidence': 'current_inventory_not_runtime', 'status': 'missing'}
        if path.is_symlink():
            item['status'] = 'symlink_not_read'
        elif path.is_file():
            try:
                text = file_text(path)
                item.update(status='present', digest=digest(text), instruction_digest=digest(text.strip()), bytes=len(text.encode()))
                if path.name in {'AGENTS.md', 'AGENTS.override.md'}:
                    item['policy'] = policy_signal(text)
                elif path.suffix == '.toml':
                    role = tomllib.loads(text)
                    item.update(model=identifier(role.get('model')), effort=identifier(role.get('model_reasoning_effort')),
                                prompt_digest=digest(role['developer_instructions']) if isinstance(role.get('developer_instructions'), str) else None)
            except (ValueError, OSError, UnicodeError):
                item['status'] = 'unreadable'
        items.append(item)
    return items


def sdd_artifacts(project: Path, change_id: str | None) -> dict:
    if not change_id:
        return {'association': 'unknown', 'tasks': [], 'events': []}
    if not re.fullmatch(r'CHG-\d{8}-[A-Za-z0-9_-]{1,80}', change_id):
        raise ValueError('Use an English CHG-YYYYMMDD-slug identifier')
    locations = [project/'docs/05-changes'/area/change_id for area in ('C01-进行中', 'C02-已完成')]
    found = [p for p in locations if p.exists()]
    if len(found) > 1:
        raise ValueError('Ambiguous active/completed Change')
    if not found:
        return {'association': 'explicit', 'change_id': change_id, 'status': 'not_found', 'tasks': [], 'events': []}
    directory = found[0]
    if any(p.is_symlink() for p in (directory, *directory.parents)):
        raise ValueError('Symlink SDD directory refused')
    index_text = file_text(directory/'index.md')
    fields = frontmatter(index_text)
    if fields.get('id') != change_id:
        raise ValueError('Change identity mismatch')
    result = {'association': 'explicit', 'change_id': change_id, 'status': fields.get('status'),
              'index_digest': digest(index_text), 'tasks': [], 'events': []}
    contract = file_text(safe_child(directory, fields.get('contract')))
    result['contract_digest'] = digest(contract)
    result['source'] = 'change:' + change_id
    # Do not retain titles, reasons, AC prose or arbitrary metadata strings.
    if 'graph' not in fields:
        result['graph'] = 'absent'
        return result
    graph = json.loads(file_text(safe_relative(directory, fields['graph'])))
    tasks = graph.get('tasks') if isinstance(graph, dict) else None
    if not isinstance(tasks, list):
        raise ValueError('Task graph must have a tasks array')
    result['graph'] = 'present'
    known = set()
    for task in tasks:
        if not isinstance(task, dict):
            raise ValueError('Invalid task object')
        key = identifier(task.get('id'))
        if not key or key in known or task.get('state') not in {'planned', 'running', 'submitted', 'accepted', 'blocked'}:
            raise ValueError('Invalid task identity/state')
        known.add(key)
        current = {k: task.get(k) for k in ('id', 'state', 'attempt', 'contract_digest', 'baseline', 'result_revision')}
        if current['attempt'] is not None and (type(current['attempt']) is not int or current['attempt'] < 0):
            raise ValueError('Invalid task attempt')
        for key_name in ('contract_digest', 'baseline', 'result_revision'):
            current[key_name] = identifier(current.get(key_name))
        history = task.get('history', [])
        if not isinstance(history, list):
            raise ValueError('Invalid history')
        for n, event in enumerate(history):
            if not isinstance(event, dict):
                raise ValueError('Invalid history entry')
            state = event.get('state')
            if state not in {'planned', 'running', 'submitted', 'accepted', 'blocked'}:
                raise ValueError('Invalid history state')
            action = event.get('action')
            normalized = {'kind': 'sdd.history', 'state': state, 'action': action if action in {'rework', 'replan', 'block'} else None,
                          'at': instant(event.get('timestamp')), 'change_id': change_id, 'task_id': task['id'],
                          'attempt': event.get('attempt') if type(event.get('attempt')) is int else None,
                          'source': result['source'], 'line': n + 1, 'locator': f'tasks/{task["id"]}/history/{n}'}
            normalized['direct'] = event.get('invalidated_by') == task['id'] if action in {'rework', 'replan'} else None
            result['events'].append(normalized)
        result['tasks'].append(current)
    return result


def select(root_trace: dict, traces: list[dict], turn: str | None) -> tuple[list[dict], list[dict], list[str]]:
    root_id = root_trace['id']
    turns = root_trace['turns']
    if not turn and len(turns) > 1:
        raise ValueError('Root session contains multiple turns; select --turn to avoid conflating separate user tasks')
    selected_turn = turn or (turns[0] if turns else None)
    if turn and turn not in turns and not any(e['turn'] == turn for e in root_trace['events']):
        raise ValueError('Requested turn not found in root rollout')
    root_events = [dict(e, session=root_id) for e in root_trace['events'] if e['turn'] == selected_turn or e['turn'] is None]
    start = next((e['at'] for e in root_events if e['kind'] == 'turn.start'), None)
    end = next((e['at'] for e in reversed(root_events) if e['kind'] == 'turn.end'), None)
    events = list(root_events)
    sessions = []
    issues = list(root_trace['issues'])
    selected = {root_id: root_trace}
    role_by_child = {}
    while True:
        expected = {e.get('fact', {}).get('child'): e.get('fact', {}).get('role') for e in events
                    if e.get('fact', {}).get('kind') in {'agent.spawn', 'agent.resume', 'agent.message'} and e.get('status') == 'success'}
        expected.pop(None, None)
        resumed = {e.get('fact', {}).get('child') for e in events if e.get('fact', {}).get('kind') in {'agent.resume', 'agent.message'} and e.get('status') == 'success'}
        role_by_child.update({key: role for key, role in expected.items() if role})
        # Select children by confirmed spawn ID only, never by cwd or filename proximity.
        added = False
        for candidate in traces:
            if candidate['id'] not in expected or candidate['id'] in selected:
                continue
            if candidate['id'] not in resumed and candidate['parent'] and candidate['parent'] not in selected:
                issues.append('conflicting_parent'); continue
            selected[candidate['id']] = candidate
            issues.extend(candidate['issues'])
            child_events = candidate['events']
            if start and end:
                child_events = [e for e in child_events if e['at'] and start <= e['at'] <= end]
            else:
                issues.append('child_time_scope_unknown')
                child_events = []
            events.extend(dict(e, session=candidate['id']) for e in child_events)
            added = True
        if not added:
            for child in expected:
                if child not in selected:
                    issues.append('child_rollout_missing')
            break
    for key, trace in selected.items():
        sess_events = [e for e in events if e['session'] == key]
        # Latest cumulative sample minus last pre-window sample; missing baselines remain unknown.
        samples = [e for e in trace['events'] if e['kind'] == 'usage.total']
        current = [e for e in sess_events if e['kind'] == 'usage.total']
        before = [e for e in samples if start and e['at'] and e['at'] < start]
        usage = None
        if current:
            base = before[-1]['usage'] if before else None
            # Root first turn has no previous usage; forked children never assume a zero baseline.
            if base is None and key == root_id and not trace['parent'] and not trace['forked'] and selected_turn == (turns[0] if turns else None):
                base = {k: 0 for k in current[-1]['usage']}
            if base is not None and set(base) >= set(current[-1]['usage']):
                delta = {k: v - base[k] for k, v in current[-1]['usage'].items()}
                if all(v >= 0 for v in delta.values()):
                    usage = delta
                else:
                    issues.append('usage_counter_reset')
        contexts = [e for e in sess_events if e['kind'] == 'context']
        sessions.append({'id': key, 'source': trace['source'], 'source_digest': trace['source_digest'], 'parent': trace['parent'], 'role': 'main' if key == root_id else role_by_child.get(key) or trace['role'],
                         'version': trace['version'], 'usage': usage, 'model': contexts[-1].get('model') if contexts else None,
                         'effort': contexts[-1].get('effort') if contexts else None,
                         'policies': [p for p in trace['policy'] if p['turn'] in {None, selected_turn} or key != root_id]})
    for e in events:
        if e.get('fact', {}).get('kind') == 'opaque':
            issues.append('opaque_tool_execution')
        if e['kind'] == 'tool' and e['status'] == 'unknown':
            issues.append('tool_result_unknown')
    if not any(e['kind'] == 'turn.start' for e in root_events):
        issues.append('turn_start_missing')
    if not any(e['kind'] == 'turn.end' for e in root_events):
        issues.append('turn_end_missing')
    return sessions, events, sorted(set(issues))


def collect(project: Path, rules_root: Path, session_file: Path, sessions_dir: Path | None = None,
            turn: str | None = None, change: str | None = None, expected_mode='unknown', expected_roles=()) -> dict:
    root_trace = read_rollout(session_file)
    candidates = []
    scan_errors = 0
    if sessions_dir:
        if sessions_dir.is_symlink() or not sessions_dir.is_dir():
            raise ValueError('Sessions directory must be a real directory')
        # Only headers are read for unrelated sessions. Full content only for linked descendants.
        pending = [p for p in sessions_dir.rglob('*.jsonl') if not p.is_symlink() and p.resolve() != session_file.resolve()]
        indexed = {}
        for path in pending:
            try:
                with path.open('rb') as stream:
                    row = json.loads(stream.readline(8 * 1024 * 1024 + 1))
                if row.get('type') != 'session_meta':
                    continue
                key = identifier(row.get('payload', {}).get('id'))
                if key:
                    if key in indexed:
                        scan_errors += 1
                    else:
                        indexed[key] = path
            except (OSError, ValueError, UnicodeError, AttributeError, TypeError):
                scan_errors += 1
        if not turn and len(root_trace['turns']) > 1:
            raise ValueError('Root session contains multiple turns; select --turn to avoid conflating separate user tasks')
        chosen_turn = turn or (root_trace['turns'][0] if root_trace['turns'] else None)
        root_scoped = dict(root_trace, events=[e for e in root_trace['events'] if e['turn'] in {None, chosen_turn}])
        queue = [root_scoped]
        visited = {root_trace['id']}
        while queue:
            trace = queue.pop()
            for event in trace['events']:
                child = event.get('fact', {}).get('child')
                if child and child not in visited and child in indexed:
                    visited.add(child)
                    try:
                        parsed = read_rollout(indexed[child])
                        candidates.append(parsed); queue.append(parsed)
                    except (OSError, ValueError):
                        scan_errors += 1
    sessions, events, issues = select(root_trace, candidates, turn)
    if scan_errors:
        issues.append('session_index_partial')
    if not change:
        changes = {e.get('fact', {}).get('change_id') for e in events if e.get('status') == 'success'} - {None}
        change = next(iter(changes)) if len(changes) == 1 else None
    sdd = sdd_artifacts(project, change)
    snapshots = snapshot(project, rules_root)
    fingerprint = digest(json.dumps([(x['path'], x.get('digest')) for x in snapshots], sort_keys=True))
    return {'schema': 1, 'collected_at': datetime.now(timezone.utc).isoformat(),
            'project_key': digest(str(project.resolve())), 'root_session': root_trace['id'],
            'turn': turn or (root_trace['turns'][0] if len(root_trace['turns']) == 1 else None),
            'expectation': {'mode': expected_mode, 'roles': sorted(set(expected_roles)), 'source': 'operator_not_model'},
            'sessions': sessions, 'events': events, 'coverage': {'status': 'partial' if issues else 'observed', 'issues': sorted(set(issues))},
            'snapshots': snapshots, 'configuration_fingerprint': fingerprint,
            'configuration_basis': 'current_inventory_not_proven_active', 'sdd': sdd}


def scan_runs(project: Path, rules_root: Path, sessions_dir: Path, since: str | None = None, max_runs=100):
    """Batch existing root turns for a project; no prompt changes or model-driven trigger.

    Only session header cwd is used for project filtering. Change/Task correlation
    still requires explicit IDs in successful calls, never cwd alone.
    """
    if sessions_dir.is_symlink() or not sessions_dir.is_dir():
        raise ValueError('Sessions directory must be a real directory')
    if since and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', since):
        raise ValueError('--since requires YYYY-MM-DD (UTC)')
    if max_runs < 1:
        raise ValueError('--max-runs must be positive')
    selected = []
    skipped = 0
    for path in sorted(sessions_dir.rglob('*.jsonl')):
        if path.is_symlink():
            skipped += 1; continue
        try:
            with path.open('rb') as stream:
                header = json.loads(stream.readline(8 * 1024 * 1024 + 1))
            meta = header.get('payload', {})
            if header.get('type') != 'session_meta' or not isinstance(meta, dict):
                continue
            cwd = meta.get('cwd')
            if not isinstance(cwd, str) or not Path(cwd).resolve().is_relative_to(project.resolve()):
                continue
            source = meta.get('source', {})
            if meta.get('parent_thread_id') or meta.get('agent_role') in ROLES-{'main'} or (isinstance(source, dict) and 'subagent' in source):
                continue
            trace = read_rollout(path)
            for turn in trace['turns'] or [None]:
                starts = [e['at'] for e in trace['events'] if e['turn'] == turn and e['kind'] == 'turn.start' and e['at']]
                if since and (not starts or starts[0][:10] < since):
                    continue
                selected.append((path, trace['id'], turn))
        except (OSError, ValueError, UnicodeError, AttributeError, TypeError):
            skipped += 1
    if len(selected) > max_runs:
        raise ValueError('Batch exceeds --max-runs; narrow --since or explicitly increase the bound')
    if len({(sid, turn) for _, sid, turn in selected}) != len(selected):
        raise ValueError('Duplicate root session/turn files; choose a single authoritative session directory')
    results = []
    for path, sid, turn in selected:
        run = collect(project, rules_root, path, sessions_dir, turn)
        if skipped:
            run['coverage']['issues'].append('batch_index_partial')
            run['coverage']['status'] = 'partial'
        run_id = 'run-' + digest(json.dumps([str(project.resolve()), sid, turn]))[:20]
        results.append((run_id, run))
    return results, skipped
