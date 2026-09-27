"""Lean SDD lifecycle plus deterministic routing metadata; no new state machine."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE/name/'scripts') for name in ('sdd-init', 'sdd-change', 'sdd-do', 'sdd-close')]
from sdd_common import active_change, root_path, read_text
from numbering import locked
from workflow import (context, document, contract_digest, transition, revision, ancestor, validate_delivery,
                      save_graph, planning_complete, frozen_contract_drifts)
from prepare_workspace import prepare as prepare_workspace, shared_worktree
from record_delivery import deliver as record_delivery
from import_delivery import import_delivery
from record_acceptance import accept
from close_change import close_change
from delivery_evidence import changed_files, SECTIONS
from path_contract import validate_changed_paths


def select_task(root, change_id, task_id=None):
    """Select an existing Task. Normal prepare never creates work just to justify Simple."""
    if task_id:
        return context(root, change_id, task_id)[4]['id']
    _, fields, _ = active_change(root, change_id)
    tasks = context(root, change_id)[3]['tasks'] if 'graph' in fields else []
    if len(tasks) == 1:
        return tasks[0]['id']
    if len(tasks) > 1:
        raise ValueError('Multiple Tasks: select --task explicitly')
    raise ValueError('No Task Graph: use Quick for Main-owned work, or have Architect define an SDD Task Graph before prepare')


def task_action_state(root, change_id, task_id, *, planning_ready=True):
    """Use the same frozen-contract facts as lifecycle transitions."""
    _, _, _, graph, task, _, _ = context(root, change_id, task_id)
    waiting = [dep for dep in task['depends_on']
               if next(item for item in graph['tasks'] if item['id'] == dep)['state'] != 'accepted']
    stale = frozen_contract_drifts(root, change_id, graph)
    own_drift = task_id in stale
    blockers = []
    actions = []
    state = task['state']

    if own_drift:
        return {'allowed_actions': ['request_replan_confirmation'],
                'blocked_reasons': ['frozen_contract_changed:' + task_id]}

    if state == 'planned':
        if stale:
            actions = ['request_replan_confirmation']
            blockers.append('frozen_contract_changed:' + ','.join(sorted(stale)))
        elif not planning_ready:
            actions = ['resume_architect']
            blockers.append('planning_incomplete')
        elif waiting:
            blockers.append('waiting_for_dependencies:' + ','.join(waiting))
        else:
            actions = ['prepare']
    elif state == 'running':
        actions = ['resume_worker', 'deliver']
        if not task.get('agent_session'):
            actions.insert(0, 'bind_session')
    elif state == 'submitted':
        actions = ['accept']
        if stale:
            actions.append('request_replan_confirmation')
            blockers.append('rework_blocked_by_contract_drift:' + ','.join(sorted(stale)))
        else:
            actions.append('rework')
    elif state == 'accepted':
        actions = ['integrate']
        if stale:
            actions.append('request_replan_confirmation')
            blockers.append('rework_blocked_by_contract_drift:' + ','.join(sorted(stale)))
        else:
            actions.append('rework')
    elif state == 'blocked':
        if stale:
            actions = ['request_replan_confirmation']
            blockers.append('rework_blocked_by_contract_drift:' + ','.join(sorted(stale)))
        else:
            actions = ['rework']
    return {'allowed_actions': actions, 'blocked_reasons': blockers}


def task_actions(root, change_id, task_id, *, planning_ready=True):
    return task_action_state(
        root, change_id, task_id, planning_ready=planning_ready
    )['allowed_actions']


def status(root, change_id, task_id=None):
    """Expose current SDD state and legal next actions without choosing a semantic path."""
    change, fields, _ = active_change(root, change_id)
    if 'graph' not in fields:
        return {'change': change_id, 'graph_ready': False, 'planning_ready': False,
                'allowed_actions': ['resume_architect'], 'tasks': []}
    _, _, _, graph = context(root, change_id)
    planning_error = None
    try:
        planning_complete(root, change, fields)
    except ValueError as error:
        planning_error = str(error)
    planning_ready = planning_error is None
    selected = graph['tasks']
    if task_id is not None:
        selected = [context(root, change_id, task_id)[4]]
    summaries = []
    for task in selected:
        waiting = [dep for dep in task['depends_on']
                   if next(item for item in graph['tasks'] if item['id'] == dep)['state'] != 'accepted']
        action_state = task_action_state(
            root, change_id, task['id'], planning_ready=planning_ready
        )
        summaries.append({
            'task': task['id'],
            'state': task['state'],
            'depends_on': task['depends_on'],
            'waiting_on': waiting,
            'attempt': task.get('attempt'),
            'workspace': task.get('workspace'),
            'agent_session': task.get('agent_session'),
            **action_state,
        })
    return {'change': change_id, 'graph_ready': True, 'planning_ready': planning_ready,
            'planning_error': planning_error, 'tasks': summaries}


def worker_dispatch_packet(root, change_id, task_id, *, resume=False):
    """Build a compact Task dispatch packet from frozen artifacts instead of retelling them."""
    change, fields, _, graph, task, directory, tf = context(root, change_id, task_id)
    by_id = {item['id']: item for item in graph['tasks']}
    dependencies = [{
        'task': dep,
        'state': by_id[dep]['state'],
        'revision': by_id[dep].get('result_revision'),
    } for dep in task['depends_on']]
    artifacts = {
        'change': str(document(root, change, fields, 'contract')),
        'task_contract': str(document(root, directory, tf, 'contract')),
        'delivery': str(document(root, directory, tf, 'report')),
    }
    if 'design' in fields:
        artifacts['design'] = str(document(root, change, fields, 'design'))
    return {
        'role': 'worker',
        'mode': 'sdd',
        'resume': resume,
        'goal': f'执行冻结 Task {task_id}，完成实现、测试、自审、修复、复验和 Delivery。',
        'artifacts': artifacts,
        'runtime': {
            'baseline': task.get('baseline'),
            'attempt': task.get('attempt'),
            'workspace': task.get('workspace'),
            'contract_digest': task.get('contract_digest'),
            'agent_session': task.get('agent_session'),
        },
        'dependencies': dependencies,
        'constraints': [
            '以 Task Contract 和其引用的 Design/Change 为准，不依赖调用方重新转述需求。',
            '实际 diff 必须符合当前 Task Path Contract；兄弟 Task 路径重叠不是越界。',
            '只运行当前 Task 的定向测试和必要 build/static check；不要反复运行项目全量测试。',
            '不得自行改变冻结 Contract、拆分 Task 或扩大授权范围。',
            '普通实现缺陷在当前执行上下文修复；设计缺口或契约变化必须停止并上报。',
        ],
        'expected_output': ['revision', 'changed_files', 'verification', 'self_review',
                            'remaining_issues', 'delivery_report'],
    }


def bind_session(root, change_id, task_id, agent_session):
    """Bind the spawned Worker thread once so later rework can resume the same context."""
    session = agent_session.strip() if isinstance(agent_session, str) else ''
    if not session or len(session) > 256 or any(ord(ch) < 32 for ch in session):
        raise ValueError('agent_session must be a nonempty printable identifier up to 256 characters')
    with locked(root):
        _, _, gp, graph, task, _, _ = context(root, change_id, task_id)
        if task['state'] != 'running':
            raise ValueError('Bind a Worker session only while its Task is running')
        existing = task.get('agent_session')
        if existing and existing != session:
            raise ValueError('Task is already bound to a different Worker session')
        task['agent_session'] = session
        save_graph(gp, graph)
    return dispatch_info(root, change_id, task_id, resume=bool(existing))


def dispatch_info(root, change_id, task_id, *, resume=False):
    change, fields, _, _, task, directory, tf = context(root, change_id, task_id)
    result = {'change': change_id, 'task': task_id, 'state': task['state'], 'resume': resume,
              'contract': str(document(root, change, fields, 'contract')),
              'task_contract': str(document(root, directory, tf, 'contract')),
              'report': str(document(root, directory, tf, 'report')),
              'agent_session': task.get('agent_session'),
              'allowed_actions': task_actions(root, change_id, task_id)}
    if 'design' in fields:
        result['design'] = str(document(root, change, fields, 'design'))
    result.update({key: task[key] for key in ('baseline', 'attempt', 'workspace', 'contract_digest')})
    result['dispatch'] = worker_dispatch_packet(root, change_id, task_id, resume=resume)
    return result


def prepare(root, change_id, task_id=None, *, base=None, worktree=None, reuse=False):
    task_id = select_task(root, change_id, task_id)
    with locked(root):
        change, fields, _, _, task, directory, tf = context(root, change_id, task_id)
        if task['state'] == 'running':
            if contract_digest(root, change, fields, directory, tf) != task.get('contract_digest'):
                raise ValueError('Frozen Contract changed; request user-confirmed replan')
            location = shared_worktree(root, Path(task['workspace']))
            if worktree and Path(worktree).absolute() != location:
                raise ValueError('Resume the original Worker/workspace; do not dispatch a second writer')
            if base and revision(root, base) != task['baseline']:
                raise ValueError('A running Task cannot change its assigned baseline')
            return dispatch_info(root, change_id, task_id, resume=True)
        # Same freeze/readiness/drift checks as the low-level CLI.
        transition(root, change_id, task_id, 'approve')
    # Each existing operation owns its lock and recovery. A failed prepare can be retried;
    # it never resets code, silently replans, or increments an already-running attempt.
    prepare_workspace(root, change_id, task_id, base or 'HEAD', worktree, reuse)
    return dispatch_info(root, change_id, task_id)


def draft_delivery(root, change_id, task_id, result, attempt, evidence_file):
    """Generate Git data, not claims of correctness. Existing drafts are never overwritten."""
    with locked(root):
        change, fields, _, _, task, directory, tf = context(root, change_id, task_id)
        if (task['state'] != 'running' or task.get('attempt') != attempt
                or Path(task['workspace']).resolve() != root.resolve()
                or task.get('contract_digest') != contract_digest(root, change, fields, directory, tf)):
            raise ValueError('Draft requires the current assigned workspace, frozen Contract and attempt')
        sha = revision(root, result)
        if not ancestor(root, task['baseline'], sha):
            raise ValueError('Result must descend from assigned baseline')
        files = changed_files(root, task['baseline'], sha)
        task_contract_path = document(root, directory, tf, 'contract')
        validate_changed_paths(
            read_text(task_contract_path), files,
            str(task_contract_path.relative_to(root)),
        )
        rows = ['| 文件 | 操作 | 改动点 |', '| --- | --- | --- |']
        for path, operation in sorted(files.items()):
            if any(c in path for c in ('|', '`', '\n', '\r')):
                raise ValueError('Filename cannot be safely represented in the delivery table')
            rows.append(f'| `{path}` | {operation} | 待补充。 |')
        body = '## 文件改动\n\n' + ('\n'.join(rows) if files else '无文件改动。') + '\n'
        for section in SECTIONS[1:]:
            body += '\n## '+section+'\n\n待补充。\n'
        target = Path(evidence_file).absolute()
        for part in (target, *target.parents):
            if part.is_symlink():
                raise ValueError('Refusing symlink evidence destination')
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(body)
    return {'change': change_id, 'task': task_id, 'status': 'draft', 'evidence_file': str(target),
            'revision': sha, 'attempt': attempt, 'task_state': 'running'}


def deliver(root, change_id, task_id=None, *, result='HEAD', attempt, evidence_file, draft=False):
    task_id = select_task(root, change_id, task_id)
    if draft:
        return draft_delivery(root, change_id, task_id, result, attempt, evidence_file)
    report = record_delivery(root, change_id, task_id, result, read_text(Path(evidence_file)), attempt)
    # Worker writes a report, not the authoritative submitted/accepted state.
    return {'change': change_id, 'task': task_id, 'status': 'report-written', 'report': str(report),
            'task_state': 'running'}


def close(root, change_id, task_id=None, *, accept_task=False, archive=False, reason='', from_workspace=None):
    if not accept_task and not archive:
        raise ValueError('Choose --accept and/or --archive; no implicit acceptance')
    if accept_task and not reason.strip():
        raise ValueError('--accept requires the Main acceptance judgment in --reason')
    result = {'change': change_id}
    if accept_task:
        task_id = select_task(root, change_id, task_id)
        change, fields, _, _, task, directory, tf = context(root, change_id, task_id)
        if from_workspace is not None:
            source = shared_worktree(root, Path(from_workspace).absolute())
            if str(source) != task.get('workspace'):
                raise ValueError('Delivery source is not the assigned workspace')
        if task['state'] == 'running':
            source = Path(task['workspace'])
            if source.resolve() == root.resolve():
                with locked(root):
                    transition(root, change_id, task_id, 'submit')
            else:
                import_delivery(root, change_id, task_id, source)
        if task['state'] == 'accepted':
            report = read_text(document(root, directory, tf, 'report'))
            task_contract_path = document(root, directory, tf, 'contract')
            if (task.get('contract_digest') != contract_digest(root, change, fields, directory, tf)
                    or task.get('report_digest') != hashlib.sha256(report.encode()).hexdigest()
                    or validate_delivery(
                        root, task, report, read_text(task_contract_path),
                        str(task_contract_path.relative_to(root)),
                    ) != task.get('result_revision')):
                raise ValueError('Accepted Contract or report changed')
        else:
            accept(root, change_id, task_id, 'accept', reason)
        result.update(task=task_id, state='accepted')
    if archive:
        # Checks integrated ancestry, all acceptances, Current Truth assessments,
        # report/contract fingerprints and the explicitly authored final decision.
        destination = close_change(root, change_id)
        result.update(state='completed', path=str(destination))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    commands = {}
    for name in ('status', 'prepare', 'bind-session', 'deliver', 'close'):
        command = actions.add_parser(name)
        command.add_argument('change_id')
        command.add_argument('--root', default=str(Path.cwd()))
        command.add_argument('--task', dest='task_id')
        commands[name] = command
    commands['prepare'].add_argument('--base')
    commands['prepare'].add_argument('--worktree')
    commands['prepare'].add_argument('--reuse', action='store_true')
    commands['bind-session'].add_argument('--agent-session', required=True)
    commands['deliver'].add_argument('--revision', default='HEAD')
    commands['deliver'].add_argument('--attempt', type=int, required=True)
    commands['deliver'].add_argument('--evidence-file', type=Path, required=True)
    commands['deliver'].add_argument('--draft', action='store_true')
    commands['close'].add_argument('--accept', action='store_true', dest='accept_task')
    commands['close'].add_argument('--archive', action='store_true')
    commands['close'].add_argument('--reason', default='')
    commands['close'].add_argument('--from-workspace', type=Path)
    args = parser.parse_args()
    try:
        root = root_path(args.root)
        if args.action == 'status':
            result = status(root, args.change_id, args.task_id)
        elif args.action == 'prepare':
            result = prepare(root, args.change_id, args.task_id, base=args.base, worktree=args.worktree, reuse=args.reuse)
        elif args.action == 'bind-session':
            task_id = select_task(root, args.change_id, args.task_id)
            result = bind_session(root, args.change_id, task_id, args.agent_session)
        elif args.action == 'deliver':
            result = deliver(root, args.change_id, args.task_id, result=args.revision, attempt=args.attempt,
                             evidence_file=args.evidence_file, draft=args.draft)
        else:
            result = close(root, args.change_id, args.task_id, accept_task=args.accept_task, archive=args.archive,
                           reason=args.reason, from_workspace=args.from_workspace)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, str(error)+'\n')


if __name__ == '__main__':
    main()
