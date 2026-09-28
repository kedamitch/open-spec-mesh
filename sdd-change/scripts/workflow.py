"""Main-owned Task lifecycle, versioned dispatch and explicit invalidation."""
import hashlib
import json
from pathlib import Path
import subprocess
from sdd_common import active_change, inside, metadata, read_text, mapped_document
from markdown_contract import split_contract
from numbering import atomic
from task_graph import load_graph, validate_graph
from delivery_evidence import validate_evidence
from contract_readiness import (planning_lines, validate_change, validate_task,
                                validate_design_backed_task, validate_design_task_graph,
                                task_contract_references, scoped_change_contract,
                                scoped_design_contract)


def document(root, directory, fields, key):
    name = fields[key]
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts or '\\' in name:
        raise ValueError('Metadata document mapping is invalid')
    if key != 'graph' and relative.name != name:
        raise ValueError('Metadata document must be a direct child')
    return inside(root, directory.relative_to(root), *relative.parts)


def planning_part(text):
    return split_contract(text)[0]


def context(root, change_id, task_id=None):
    change, fields, _ = active_change(root, change_id)
    if 'graph' not in fields:
        raise ValueError('Change has no Task graph')
    graph_path = document(root, change, fields, 'graph')
    graph = load_graph(graph_path)
    validate_graph(graph)
    if task_id is None:
        return change, fields, graph_path, graph
    task = next((t for t in graph['tasks'] if t['id'] == task_id), None)
    if task is None:
        raise ValueError('Unknown task')
    if not isinstance(task.get('path'), str) or not isinstance(task.get('history'), list):
        raise ValueError('Task requires a relative path and history array')
    directory = inside(root, change.relative_to(root), task['path'])
    task_root = document(root, change, fields, 'tasks')
    if directory.parent != task_root:
        raise ValueError('Task must be a direct child of its mapped task directory')
    tf, _ = metadata(read_text(directory / 'index.md'))
    if tf.get('id') != task_id or set(tf) != {'id', 'contract', 'report'}:
        raise ValueError('Task index contract is invalid')
    for key in ('contract', 'report'):
        document(root, directory, tf, key)
    return change, fields, graph_path, graph, task, directory, tf


def save_graph(path, data):
    validate_graph(data)
    atomic(path, json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def contract_digest(root, change, fields, directory, tf):
    change_source = mapped_document(root, change, fields, 'contract')
    change_text = read_text(change_source)
    task_source = document(root, directory, tf, 'contract')
    task_text = read_text(task_source)
    design_source = mapped_document(root, change, fields, 'design')
    design_text = read_text(design_source)

    try:
        graph = load_graph(document(root, change, fields, 'graph'))
        validate_graph(graph)
        task = next((item for item in graph['tasks'] if item['id'] == tf['id']), None)
        if task is None:
            raise ValueError('Task missing from canonical Graph')
        definitions = validate_change(change_text, str(change_source.relative_to(root)))
        validate_design_task_graph(
            design_text, graph['tasks'],
            str(design_source.relative_to(root)), definitions)
        refs = task_contract_references(
            task_text, task, [item['id'] for item in graph['tasks']],
            definitions, str(task_source.relative_to(root)))
        parts = [
            scoped_change_contract(
                change_text, refs['acs'], str(change_source.relative_to(root))),
            scoped_design_contract(
                design_text, task['id'], refs['design'],
                str(design_source.relative_to(root))),
            task_text.rstrip() + '\n',
        ]
    except ValueError:
        parts = [change_text, design_text, task_text]

    return hashlib.sha256('\n---SDD-CONTRACT---\n'.join(parts).encode()).hexdigest()


def planning_complete(root, change, fields, directory=None, tf=None):
    """One readiness gate for approval, dispatch, and document-only closure."""
    source = mapped_document(root, change, fields, 'contract')
    definitions = validate_change(read_text(source), str(source.relative_to(root)))
    design_source = mapped_document(root, change, fields, 'design')
    design_text = read_text(design_source)
    try:
        planning_lines(design_text, str(design_source.relative_to(root)))
    except ValueError as error:
        raise ValueError('Unfinished Design contract: ' + str(error)) from error
    graph = load_graph(document(root, change, fields, 'graph'))
    validate_graph(graph)
    design_mapping = validate_design_task_graph(
        design_text, graph['tasks'],
        str(design_source.relative_to(root)), definitions)
    task_ids = [item['id'] for item in graph['tasks']]
    for item in graph['tasks']:
        task_dir = inside(root, change.relative_to(root), item['path'])
        task_fields, _ = metadata(read_text(task_dir / 'index.md'))
        task_source = document(root, task_dir, task_fields, 'contract')
        task_text = read_text(task_source)
        validate_task(task_text, definitions, str(task_source.relative_to(root)))
        validate_design_backed_task(
            task_text, design_source.name, item, design_text,
            definitions, task_ids, str(task_source.relative_to(root)),
            design_mapping)
    return definitions


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr.strip() or 'Git command failed')
    return result.stdout.strip()


def revision(root, value):
    return git(root, 'rev-parse', '--verify', '--end-of-options', value + '^{commit}')


def ancestor(root, older, newer):
    return subprocess.run(
        ['git', '-C', str(root), 'merge-base', '--is-ancestor', older, newer],
        capture_output=True,
    ).returncode == 0


def event(task, state, **details):
    task['history'].append({'state': state, **details})
    task['state'] = state


def validate_delivery(root, task, report, task_contract, label=None):
    fields, body = metadata(report)
    if fields.get('status') != 'submitted':
        raise ValueError('Worker delivery missing')
    if fields.get('contract_digest') != task.get('contract_digest'):
        raise ValueError('Delivery is from a different contract')
    if fields.get('attempt') != str(task.get('attempt', 0)):
        raise ValueError('Stale delivery from a previous dispatch attempt')
    if fields.get('baseline') != task.get('baseline'):
        raise ValueError('Delivery baseline does not match assigned baseline')
    sha = revision(root, fields['revision'])
    if not ancestor(root, task['baseline'], sha):
        raise ValueError('Delivery must descend from assigned baseline')
    validate_evidence(
        root, task['baseline'], sha, body,
        task_contract=task_contract,
        label=label,
    )
    return sha


def frozen_contract_drifts(root, change_id, graph=None):
    """Return every frozen Task whose current canonical contract no longer matches."""
    if graph is None:
        graph = context(root, change_id)[3]
    stale = set()
    for item in graph['tasks']:
        if not item.get('contract_digest'):
            continue
        change, fields, _, _, _, directory, tf = context(root, change_id, item['id'])
        if item['contract_digest'] != contract_digest(root, change, fields, directory, tf):
            stale.add(item['id'])
    return stale


def invalidation_set(root, change_id, graph, target):
    """Reopen target, any frozen task with drift, and their transitive dependants."""
    affected = {target} | frozen_contract_drifts(root, change_id, graph)
    while True:
        more = {t['id'] for t in graph['tasks'] if set(t['depends_on']) & affected}
        if more <= affected:
            return affected
        affected |= more


def transition(root, change_id, task_id, action, reason='', *, workers_stopped=False, user_confirmed=False):
    """Caller holds the project lock. No code/checkout is reset by a transition."""
    change, fields, gp, graph, task, directory, tf = context(root, change_id, task_id)
    current = lambda: contract_digest(root, change, fields, directory, tf)
    stale = frozen_contract_drifts(root, change_id, graph)
    if action in ('approve', 'rework') and stale:
        raise ValueError(
            'Frozen contract changed; stop and obtain user confirmation before replan: '
            + ', '.join(sorted(stale))
        )
    if action == 'replan':
        if not user_confirmed:
            raise ValueError('Replan requires explicit user confirmation: --user-confirmed')
        if not stale:
            raise ValueError('Contract is unchanged; use ordinary rework, not replan')
    if action == 'approve':
        if task['state'] != 'planned':
            raise ValueError('Approve Contract before execution')
        planning_complete(root, change, fields, directory, tf)
        task['contract_digest'] = current()
    elif action == 'submit':
        if task['state'] != 'running':
            raise ValueError('Only running tasks can submit')
        if task.get('contract_digest') != current():
            raise ValueError('Frozen Contract changed; Main must request user-confirmed replan')
        report = read_text(document(root, directory, tf, 'report'))
        task_contract_path = document(root, directory, tf, 'contract')
        sha = validate_delivery(
            root, task, report, read_text(task_contract_path),
            str(task_contract_path.relative_to(root)),
        )
        task.update(result_revision=sha, report_digest=hashlib.sha256(report.encode()).hexdigest())
        event(task, 'submitted', revision=sha, attempt=task.get('attempt', 0))
    elif action in ('rework', 'replan', 'block'):
        if not reason.strip():
            raise ValueError('A reason is required')
        affected = invalidation_set(root, change_id, graph, task_id)
        live = [t['id'] for t in graph['tasks'] if t['id'] in affected and t['state'] == 'running']
        if live and not workers_stopped:
            raise ValueError('Stop affected workers first, then pass --workers-stopped: ' + ', '.join(live))
        for item in graph['tasks']:
            if item['id'] not in affected:
                continue
            previous = {key: item[key] for key in (
                'state', 'baseline', 'workspace', 'result_revision',
                'report_digest', 'contract_digest', 'attempt', 'agent_session'
            ) if key in item}
            keys = ('result_revision', 'report_digest') if action == 'block' else (
                'baseline', 'result_revision', 'report_digest', 'contract_digest'
            )
            for key in keys:
                item.pop(key, None)
            state = 'blocked' if action == 'block' else 'planned'
            event(
                item, state, action=action, reason=reason, invalidated_by=task_id,
                previous=previous,
                user_confirmed=(action == 'replan' and user_confirmed),
            )
    else:
        raise ValueError('Unknown transition')
    save_graph(gp, graph)
    return task['state']
