"""Validate structured Worker delivery against the real Git diff and Task Contract."""
import re
import subprocess
from markdown_contract import visible_lines
from path_contract import validate_changed_paths

SECTIONS = ('文件改动', '验证结果', '自审结论', '剩余问题', '快照影响')
CONCLUSIONS = {'通过', '部分通过', '未通过'}
AC_RESULTS = {'通过', '失败', '未执行'}
SNAPSHOT_SCOPES = {'无', 'product', 'technology', 'operations', 'multiple'}
NONE = {'无', 'none', '-'}

AC = re.compile(r'(?<![A-Za-z0-9_-])AC-[0-9]+(?![A-Za-z0-9_-])')


def changed_files(root, baseline, revision):
    result = subprocess.run(['git', '-C', str(root), 'diff', '--name-status', '--no-renames', '-z',
                             baseline, revision, '--'], capture_output=True)
    if result.returncode:
        raise ValueError('Cannot inspect delivery Git diff')
    fields = result.stdout.decode('utf-8').split('\0')
    if fields[-1] == '':
        fields.pop()
    if len(fields) % 2:
        raise ValueError('Unexpected Git name-status response')
    return {fields[i + 1]: fields[i] for i in range(0, len(fields), 2)}


def require_evidence_body(text, name):
    """Reject empty/comment-only/placeholder reports, while retaining fenced command output."""
    body = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL).strip()
    if (not body or body.casefold() in {'pending', 'tbd', 'todo'}
            or '待补充' in body or '待交付' in body):
        raise ValueError('Incomplete evidence: ' + name)
    return body


def _clean(value):
    return value.strip().strip('*_').strip().rstrip('。.')


def _none(value):
    return _clean(value).casefold() in NONE


def _sections(evidence):
    lines = evidence.splitlines(keepends=True)
    heads = [(i, line[3:]) for i, line in visible_lines(evidence) if line.startswith('## ')]
    if tuple(name for _, name in heads) != SECTIONS:
        raise ValueError('Evidence must have exactly these sections: ' + ', '.join(SECTIONS))
    bodies = {}
    for j, (i, name) in enumerate(heads):
        end = heads[j + 1][0] if j + 1 < len(heads) else len(lines)
        value = ''.join(lines[i + 1:end]).strip()
        require_evidence_body(value, name)
        bodies[name] = value
    return bodies


def _field(text, name):
    values = []
    pattern = re.compile(r'^\*\*' + re.escape(name) + r'\*\*\s*[:：]\s*(.+)$')
    for _, line in visible_lines(text):
        value = re.sub(r'^(?:>\s*)+', '', line.strip())
        value = re.sub(r'^[-*+]\s+', '', value)
        match = pattern.fullmatch(value)
        if match:
            values.append(match[1].strip())
    if len(values) != 1:
        raise ValueError(f'Delivery requires exactly one structured field: {name}')
    require_evidence_body(values[0], name)
    return values[0]


def _table_rows(text, header):
    rows = []
    found_header = False
    for _, line in visible_lines(text):
        value = line.strip()
        if not value.startswith('|'):
            continue
        cells = [cell.strip() for cell in value.strip('|').split('|')]
        if cells == header:
            if found_header:
                raise ValueError('Duplicate delivery table header')
            found_header = True
            continue
        if cells and all(re.fullmatch(r':?-+:?', cell) for cell in cells):
            continue
        if len(cells) != len(header):
            raise ValueError('Delivery table has an unexpected column count')
        rows.append(cells)
    if not found_header:
        raise ValueError('Delivery table header is required: ' + ' / '.join(header))
    return rows


def task_ac_refs(task_contract):
    """Read canonical AC order from the Task's 验收标准 subsection."""
    match = re.search(
        r'^###\s+验收标准\s*$\n(.*?)(?=^###\s|^##\s|\Z)',
        task_contract, re.M | re.S)
    if not match:
        raise ValueError('Task Contract requires 验收标准 for Delivery generation')
    refs = []
    for _, line in visible_lines(match.group(1)):
        for item in AC.findall(line):
            if item not in refs:
                refs.append(item)
    if not refs:
        raise ValueError('Task Contract 验收标准 must reference at least one AC')
    return refs


def structured_delivery(evidence, task_contract=None):
    """Parse fixed human-readable Delivery fields without judging business truth."""
    bodies = _sections(evidence)
    result = {
        'delivery_result': _field(bodies['文件改动'], '交付结果'),
        'conclusion': _clean(_field(bodies['验证结果'], '结论')),
        'fixed_issues': _field(bodies['自审结论'], '已修复问题'),
        'contract_deviation': _field(bodies['自审结论'], '契约偏差'),
        'unverified': _field(bodies['剩余问题'], '未验证项'),
        'remaining_risk': _field(bodies['剩余问题'], '剩余风险'),
        'snapshot_scope': _clean(_field(bodies['快照影响'], '范围')),
        'snapshot_note': _field(bodies['快照影响'], '说明'),
    }
    if result['conclusion'] not in CONCLUSIONS:
        raise ValueError('Delivery 结论 must be one of: ' + ', '.join(sorted(CONCLUSIONS)))
    if result['snapshot_scope'] not in SNAPSHOT_SCOPES:
        raise ValueError('Delivery 快照范围 must be one of: ' + ', '.join(sorted(SNAPSHOT_SCOPES)))

    validation_rows = _table_rows(bodies['验证结果'], ['AC / 场景', '检查', '结果', '证据'])
    if not validation_rows:
        raise ValueError('Delivery validation table requires at least one result row')
    ac_results = {}
    for cells in validation_rows:
        check, outcome, proof = cells[1], _clean(cells[2]), cells[3]
        require_evidence_body(check, 'validation check')
        require_evidence_body(proof, 'validation evidence')
        if outcome not in AC_RESULTS:
            raise ValueError('Delivery AC result must be one of: ' + ', '.join(sorted(AC_RESULTS)))
        refs = AC.findall(cells[0])
        if len(refs) > 1:
            raise ValueError('Each Delivery validation row may reference at most one AC')
        if refs:
            ac = refs[0]
            if ac in ac_results:
                raise ValueError('Duplicate Delivery AC row: ' + ac)
            ac_results[ac] = outcome

    if task_contract is not None:
        expected = task_ac_refs(task_contract)
        unknown = sorted(set(ac_results) - set(expected))
        missing = [item for item in expected if item not in ac_results]
        if unknown or missing:
            raise ValueError(
                f'Delivery AC rows must match Task Contract; missing={missing}; unknown={unknown}')
        result['expected_acs'] = expected
    result['ac_results'] = ac_results

    blockers = []
    blockers += [f'{ac}={outcome}' for ac, outcome in ac_results.items() if outcome != '通过']
    if not _none(result['contract_deviation']):
        blockers.append('契约偏差')
    if not _none(result['unverified']):
        blockers.append('未验证项')
    if result['conclusion'] == '通过' and blockers:
        raise ValueError('Delivery cannot claim 通过 while blockers remain: ' + ', '.join(blockers))
    return result


def acceptance_blockers(evidence, task_contract):
    """Return mechanically provable blockers; an empty list is not automatic acceptance."""
    summary = structured_delivery(evidence, task_contract)
    blockers = []
    if summary['conclusion'] != '通过':
        blockers.append('验证结论=' + summary['conclusion'])
    blockers += [f'{ac}={outcome}' for ac, outcome in summary['ac_results'].items() if outcome != '通过']
    if not _none(summary['contract_deviation']):
        blockers.append('契约偏差')
    if not _none(summary['unverified']):
        blockers.append('未验证项')
    return blockers


def validate_evidence(root, baseline, revision, evidence, task_contract=None, label='Task Path Contract'):
    bodies = _sections(evidence)
    structured_delivery(evidence, task_contract)

    notes = {}
    for cells in _table_rows(bodies['文件改动'], ['文件', '操作', '行为影响']):
        match = re.fullmatch(r'`([^`]+)`', cells[0])
        if not match:
            raise ValueError('Delivery file rows require a backticked path')
        path = match[1]
        if path in notes or not cells[1] or not cells[2] or cells[2] in ('-', '无'):
            raise ValueError('Each file requires a unique path, operation and concrete behavior impact')
        require_evidence_body(cells[2], 'file note: ' + path)
        notes[path] = cells[1:]

    actual = changed_files(root, baseline, revision)
    if task_contract is not None:
        validate_changed_paths(task_contract, actual, label)
    if set(notes) != set(actual):
        raise ValueError(f'File notes must match Git diff; missing={sorted(set(actual) - set(notes))}; extra={sorted(set(notes) - set(actual))}')
    names = {'A': {'新增', 'A'}, 'M': {'修改', 'M'}, 'D': {'删除', 'D'}, 'T': {'类型变化', 'T'}}
    for path, operation in actual.items():
        if any(c in path for c in ('|', '`', '\n', '\r')):
            raise ValueError('Filename cannot be safely represented in this delivery table')
        if notes[path][0] not in names.get(operation, {operation}):
            raise ValueError('Incorrect Git operation for ' + path)
    return actual
