"""Read Codex rollout JSONL without executing or retaining conversation/tool content.

Adapters deliberately recognize a limited set of native envelopes. Unknown/opaque
execution is counted as missing coverage, never silently converted to compliance.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shlex
from typing import Any

ROLES = {'main', 'architect', 'worker', 'reviewer', 'explorer', 'librarian'}
SKILLS = {'sdd-init', 'sdd-migrate', 'sdd-change', 'sdd-do', 'sdd-close', 'sdd-release', 'sdd-research', 'prd-spec', 'design-overview'}
MAX_LINE = 8 * 1024 * 1024
SAFE_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z')
COMMANDS = {
    'new_change.py': 'change.create', 'ensure_design.py': 'design.create',
    'new_task.py': 'task.create', 'prepare_workspace.py': 'task.prepare',
    'record_delivery.py': 'task.deliver', 'import_delivery.py': 'task.submit',
    'run_validation.py': 'change.validate',
    'check_change.py': 'change.check', 'close_change.py': 'change.close',
}


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def identifier(value: Any) -> str | None:
    return value if isinstance(value, str) and SAFE_ID.fullmatch(value) else None


def instant(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo is None:
            return None
        return date.astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def json_object(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            obj = json.loads(value)
            return obj if isinstance(obj, dict) else {}
        except (ValueError, TypeError):
            pass
    return {}


def native_name(value: Any) -> str:
    if not isinstance(value, str):
        return ''
    return value.rsplit('.', 1)[-1].rsplit('__', 1)[-1]


def policy_signal(text: str) -> str | None:
    """Recognize the repo's actual routing table, not arbitrary keyword proximity."""
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    fence = None
    for line in text.splitlines():
        mark = re.match(r'^ {0,3}(`{3,}|~{3,})', line)
        if mark:
            if fence is None:
                fence = mark[1]
            elif mark[1][0] == fence[0] and len(mark[1]) >= len(fence):
                fence = None
            continue
        if fence or line.startswith(('    ', '\t')):
            continue
        if re.match(r'^\|\s*Explorer\s*/\s*Librarian\s*\|', line):
            if '已批准 Complex' in line:
                return 'explorer_requires_complex'
            return 'unrecognized_explorer_rule'
    return None


def command_fact(value: Any) -> dict:
    """Only a single literal command. Never eval/source/execute captured input."""
    try:
        parts = value if isinstance(value, list) else shlex.split(value)
        if not parts or any(not isinstance(p, str) for p in parts):
            return {'kind': 'opaque'}
        if Path(parts[0]).name in {'bash', 'sh', 'zsh'} and len(parts) == 3 and parts[1] in {'-c', '-lc'}:
            return command_fact(parts[2])
        # Shell interpolation, pipelines and compound commands need real native events.
        if any(re.search(r'[\n;|&<>`$]', p) for p in parts):
            return {'kind': 'opaque'}
        executable = Path(parts[0]).name
        if executable in {'cat', 'head', 'tail'}:
            skills = sorted({p.split('/')[-2] for p in parts[1:]
                             if p.endswith('/SKILL.md') and p.split('/')[-2] in SKILLS})
            return {'kind': 'skill.read', 'skills': skills} if skills else {'kind': 'local.read'}
        if executable in {'rg', 'grep', 'find', 'ls', 'sed'}:
            return {'kind': 'local.read'}
        if executable not in {'python', 'python3', 'python3.11', 'python3.13'}:
            return {'kind': 'other.command'}
        script_index = next((i for i, p in enumerate(parts[1:], 1) if not p.startswith('-')), None)
        if script_index is None:
            return {'kind': 'opaque'}
        script = parts[script_index]
        # A quoted example passed to echo/python -c is NOT an executed SDD script.
        if '-c' in parts[:script_index] or '/scripts/' not in script or not any(s + '/scripts/' in script for s in SKILLS):
            return {'kind': 'opaque'}
        args = parts[script_index + 1:]
        basename = Path(script).name
        def flag(name):
            try:
                return args[args.index(name) + 1]
            except (ValueError, IndexError):
                return None
        change = next((x for x in args if re.fullmatch(r'CHG-\d{8}-[A-Za-z0-9_-]+', x)), None)
        task = next((x for x in args if re.fullmatch(r'C\d{2}(?:-\d{2})+', x)), None)
        kind = COMMANDS.get(basename, 'other.command')
        if basename == 'task_graph.py' and flag('--action') in {'approve', 'submit', 'block', 'rework', 'replan'}:
            kind = 'task.' + flag('--action')
        if basename == 'record_acceptance.py':
            kind = 'task.accept' if 'accept' in args else ('task.rework' if 'rework' in args else 'opaque')
        if script.endswith('sdd-change/scripts/sdd.py') and args and not {'--help', '-h'}.intersection(args):
            # One observed invocation, not invented internal stages. Actual Task
            # states/attempts still come from the existing graph and history.
            if args[0] == 'status':
                kind = 'task.status'
            elif args[0] == 'prepare':
                kind = 'task.prepare'
            elif args[0] == 'bind-session':
                kind = 'task.bind-session'
            elif args[0] == 'deliver':
                kind = 'task.delivery-draft' if '--draft' in args else 'task.deliver'
            elif args[0] == 'close':
                if '--archive' in args:
                    kind = 'change.close'
                elif '--accept' in args:
                    kind = 'task.accept'
        return {'kind': kind, 'change_id': identifier(change), 'task_id': identifier(task)}
    except (TypeError, ValueError):
        return {'kind': 'opaque'}


def output_status(value: Any) -> tuple[str, dict]:
    data = json_object(value)
    code = data.get('exit_code')
    if code is None and isinstance(data.get('metadata'), dict):
        code = data['metadata'].get('exit_code')
    if data.get('error') or data.get('is_error') is True or data.get('isError') is True:
        return 'failed', data
    if type(code) is int:
        return ('success' if code == 0 else 'failed'), data
    if isinstance(value, str):
        match = re.search(r'(?m)^(?:Process exited with code|Exit code:)\s*(-?\d+)\s*$', value)
        if match:
            return ('success' if int(match[1]) == 0 else 'failed'), data
    return 'unknown', data


def bounded_lines(stream):
    line = 0
    while True:
        raw = stream.readline(MAX_LINE + 1)
        if not raw:
            break
        line += 1
        if len(raw) > MAX_LINE:
            while raw and not raw.endswith(b'\n'):
                raw = stream.readline(MAX_LINE + 1)
            yield line, b' ' * (MAX_LINE + 1)
        else:
            yield line, raw


def read_rollout(path: Path) -> dict:
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
        raise ValueError('Rollout must be a regular non-symlink file')
    before = path.stat()
    if before.st_size > 128 * 1024 * 1024:
        raise ValueError('Rollout exceeds the 128 MiB input bound; export a smaller trace')
    result = {'id': None, 'parent': None, 'role': None, 'version': None, 'events': [],
              'issues': [], 'turns': [], 'meta': False, 'usage': {}, 'policy': [], 'forked': False}
    active_turn = None
    calls = {}
    source = digest(str(path.absolute()))[:16]  # no absolute path in stored reports

    def emit(line, kind, timestamp, **values):
        event = {'source': source, 'line': line, 'kind': kind, 'at': instant(timestamp),
                 'turn': active_turn, **values}
        result['events'].append(event)
        return event

    with path.open('rb') as stream:
        for line_no, raw in bounded_lines(stream):
            if len(raw) > MAX_LINE:
                result['issues'].append('oversized_line'); continue
            try:
                row = json.loads(raw)
                if not isinstance(row, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                result['issues'].append('invalid_or_partial_json'); continue
            typ, payload = row.get('type'), row.get('payload', {})
            at = row.get('timestamp')
            if not isinstance(payload, dict):
                result['issues'].append('invalid_envelope'); continue
            try:
                if typ == 'session_meta':
                    if result['id'] and identifier(payload.get('id')) != result['id']:
                        result['issues'].append('session_identity_conflict'); continue
                    result['meta'] = True
                    result['id'] = identifier(payload.get('id'))
                    result['version'] = identifier(payload.get('cli_version'))
                    result['forked'] = bool(payload.get('forked_from_id') or payload.get('forked_from'))
                    source_data = payload.get('source', {})
                    spawn = json_object(json_object(source_data).get('subagent')).get('thread_spawn', {})
                    spawn = json_object(spawn)
                    result['parent'] = identifier(payload.get('parent_thread_id') or spawn.get('parent_thread_id'))
                    role = payload.get('agent_role') or spawn.get('agent_role')
                    result['role'] = role if role in ROLES else None
                    # Keep no base instructions, cwd, user names or conversation text.
                elif typ == 'turn_context':
                    active_turn = identifier(payload.get('turn_id')) or active_turn
                    emit(line_no, 'context', at, model=identifier(payload.get('model')),
                         effort=identifier(payload.get('effort') or payload.get('reasoning_effort')))
                    for key in ('user_instructions', 'developer_instructions'):
                        text = payload.get(key)
                        if isinstance(text, str):
                            signal = policy_signal(text)
                            if signal:
                                result['policy'].append({'signal': signal, 'digest': digest(text.strip()),
                                                         'source': source, 'line': line_no, 'turn': active_turn,
                                                         'evidence': 'runtime_instructions'})
                elif typ == 'event_msg':
                    event_type = payload.get('type')
                    if event_type == 'task_started':
                        active_turn = identifier(payload.get('turn_id')) or active_turn
                        if active_turn and active_turn not in result['turns']:
                            result['turns'].append(active_turn)
                        emit(line_no, 'turn.start', at)
                    elif event_type in {'task_complete', 'turn_aborted'}:
                        emit(line_no, 'turn.end', at, outcome='completed' if event_type == 'task_complete' else 'aborted')
                    elif event_type == 'token_count':
                        info = payload.get('info') or {}
                        usage = info.get('total_token_usage') or {}
                        clean = {k: v for k, v in usage.items() if k in {'input_tokens', 'cached_input_tokens', 'output_tokens'}
                                 and type(v) is int and v >= 0}
                        if clean:
                            emit(line_no, 'usage.total', at, usage=clean)
                    elif event_type == 'exec_command_begin':
                        call_id = identifier(payload.get('call_id'))
                        if call_id:
                            fact = command_fact(payload.get('command'))
                            existing = calls.get(call_id)
                            if existing:
                                existing['fact'] = fact
                            else:
                                calls[call_id] = emit(line_no, 'tool', at, call_id=call_id, status='unknown', **{'fact': fact})
                    elif event_type == 'exec_command_end':
                        call_id = identifier(payload.get('call_id'))
                        if call_id in calls:
                            code = payload.get('exit_code')
                            calls[call_id]['status'] = ('success' if code == 0 else 'failed') if type(code) is int else 'unknown'
                    elif event_type in {'patch_apply_begin', 'patch_apply_end'}:
                        # Paths and patch bodies are deliberately not retained.
                        if event_type == 'patch_apply_end':
                            emit(line_no, 'implementation.write', at, status='success' if payload.get('success') is True else 'unknown')
                    elif event_type in {'collab_agent_spawn_begin', 'collab_agent_spawn_end'}:
                        call_id = identifier(payload.get('call_id'))
                        if not call_id:
                            result['issues'].append('tool_id_missing'); continue
                        call = calls.get(call_id)
                        if call is None:
                            call = emit(line_no, 'tool', at, call_id=call_id, status='unknown',
                                        fact={'kind': 'agent.spawn', 'role': 'unknown', 'fork_turns': 'unknown'})
                            calls[call_id] = call
                        if event_type.endswith('_end'):
                            child = identifier(payload.get('new_thread_id'))
                            role = payload.get('new_agent_role')
                            if role in ROLES:
                                call['fact']['role'] = role
                            if child:
                                call['fact']['child'] = child
                                call['status'] = 'success'
                            elif payload.get('status') == 'errored' or payload.get('error'):
                                call['status'] = 'failed'
                            call['end_at'] = instant(at)
                    elif event_type == 'sub_agent_activity':
                        # Newer native runtime form. Never retain prompt/message content.
                        call = calls.get(identifier(payload.get('call_id')))
                        child = identifier(payload.get('agent_thread_id'))
                        if call and child and payload.get('kind') == 'started' and call['fact']['kind'] == 'agent.spawn':
                            call['fact']['child'] = child
                            call['status'] = 'success'
                        else:
                            result['issues'].append('unlinked_agent_activity')
                    elif event_type in {'agent_message', 'agent_reasoning', 'user_message', 'agent_reasoning_raw_content',
                                         'agent_reasoning_section_break', 'agent_reasoning_raw_content_delta'}:
                        pass
                    elif isinstance(event_type, str) and event_type.startswith(('collab_', 'agent_')):
                        # Specialized collab events vary by version. Do not count them twice.
                        pass
                    elif event_type not in {'mcp_tool_call_begin', 'mcp_tool_call_end', 'web_search_begin', 'web_search_end',
                                             'view_image_tool_call', 'context_compacted', 'item_started', 'item_completed',
                                             'background_event', 'warning', 'error', 'shutdown_complete', 'plan_update'}:
                        result['issues'].append('unknown_event')
                elif typ == 'response_item':
                    item_type = payload.get('type')
                    if item_type in {'function_call', 'custom_tool_call'}:
                        call_id = identifier(payload.get('call_id'))
                        if not call_id:
                            result['issues'].append('tool_id_missing'); continue
                        name = native_name(payload.get('name'))
                        if str(payload.get('name', '')).startswith('mcp__') or payload.get('namespace') not in {None, 'agents', 'functions', 'collaboration'}:
                            name = ''  # unrelated MCP tools cannot impersonate native delegation
                        args = json_object(payload.get('arguments'))
                        if name == 'spawn_agent':
                            role = args.get('agent_type')
                            fact = {'kind': 'agent.spawn', 'role': role if role in ROLES else 'unknown',
                                    'fork_turns': args.get('fork_turns') if args.get('fork_turns') in {'none', 'all'} else 'unknown'}
                        elif name in {'resume_agent', 'send_input', 'send_message', 'followup_task'}:
                            fact = {'kind': 'agent.resume' if name in {'resume_agent', 'followup_task'} else 'agent.message',
                                    'child': identifier(args.get('id') or args.get('agent_id') or args.get('thread_id'))}
                        elif name in {'exec_command', 'shell_command', 'shell'}:
                            fact = command_fact(args.get('cmd') or args.get('command'))
                        elif name == 'apply_patch':
                            fact = {'kind': 'implementation.write'}
                        elif name in {'exec', 'js'}:
                            fact = {'kind': 'opaque'}
                        else:
                            fact = {'kind': 'other.tool'}
                        if call_id not in calls:
                            calls[call_id] = emit(line_no, 'tool', at, call_id=call_id, fact=fact, status='unknown')
                        elif calls[call_id]['fact'].get('role') == 'unknown' and fact.get('role'):
                            calls[call_id]['fact'].update(fact)
                    elif item_type in {'function_call_output', 'custom_tool_call_output'}:
                        call = calls.get(identifier(payload.get('call_id')))
                        if call:
                            status, data = output_status(payload.get('output'))
                            child = identifier(data.get('agent_id') or data.get('thread_id'))
                            if call['fact']['kind'] == 'agent.spawn' and child:
                                call['fact']['child'] = child
                                status = 'success'
                            if call['fact']['kind'] in {'agent.resume', 'agent.message'} and call['fact'].get('child') and status != 'failed':
                                if data.get('submission_id') or data.get('status') in {'running', 'completed', 'queued'}:
                                    status = 'success'
                            if status != 'unknown':
                                call['status'] = status
                            call['end_at'] = instant(at)
                    elif item_type == 'message' and payload.get('role') in {'developer', 'user'}:
                        for content in payload.get('content', []):
                            text = content.get('text', '') if isinstance(content, dict) else ''
                            if not isinstance(text, str):
                                continue
                            # Only the native injected instructions wrapper, never a quoted tool response.
                            if text.startswith('# AGENTS.md instructions for ') and '<INSTRUCTIONS>' in text:
                                body = text.partition('<INSTRUCTIONS>')[2].partition('</INSTRUCTIONS>')[0].strip()
                                signal = policy_signal(body)
                                if signal:
                                    result['policy'].append({'signal': signal, 'digest': digest(body), 'source': source,
                                                             'line': line_no, 'turn': active_turn, 'evidence': 'injected_instructions'})
                    elif item_type not in {'message', 'reasoning', 'web_search_call', 'compaction', 'ghost_snapshot'}:
                        result['issues'].append('unknown_response_item')
                elif typ in {'compacted'}:
                    result['issues'].append('compacted_history')
                else:
                    result['issues'].append('unsupported_envelope')
            except (TypeError, AttributeError, KeyError, ValueError):
                result['issues'].append('invalid_payload')
    if not result['id']:
        raise ValueError('Not a supported rollout: session_meta.id missing')
    checksum = hashlib.sha256()
    with path.open('rb') as source_file:
        for chunk in iter(lambda: source_file.read(65536), b''):
            checksum.update(chunk)
    result['source_digest'] = checksum.hexdigest()
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        result['issues'].append('source_changed_during_read')
    result['source'] = 'session:' + result['id']
    for item in result['events'] + result['policy']:
        item['source'] = result['source']
    result['issues'] = sorted(set(result['issues']))
    return result
