"""Validate dispatch evidence structure and exact Git paths, not the truth of test claims."""
import re
import subprocess
from markdown_contract import visible_lines
from path_contract import validate_changed_paths

SECTIONS = ('文件改动', '验证结果', '自审结论', '剩余问题', '快照影响')


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


def validate_evidence(root, baseline, revision, evidence, task_contract=None, label='Task Path Contract'):
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

    notes = {}
    # Examples inside a Markdown fence or comment are not delivered file records.
    for _, line in visible_lines(bodies['文件改动']):
        if not line.strip().startswith('|'):
            continue
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if len(cells) != 3:
            continue
        match = re.fullmatch(r'`([^`]+)`', cells[0])
        if not match:
            continue
        path = match[1]
        if path in notes or not cells[1] or not cells[2] or cells[2] in ('-', '无'):
            raise ValueError('Each file requires a unique path, operation and concrete change points')
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
