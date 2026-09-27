"""Validate integration identity, unchanged contracts/reports and explicit close evidence."""
import argparse
import hashlib
from pathlib import Path
import re
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE / 'sdd-init/scripts'), str(PACKAGE / 'sdd-change/scripts')]
from sdd_common import active_change, root_path, metadata, read_text, mapped_document
from workflow import context, document, revision, ancestor, contract_digest, planning_complete, git
from markdown_contract import visible_lines, split_contract
from delivery_evidence import require_evidence_body
from validation_receipt import validate_receipt


def require_pass(text):
    lines = [line for _, line in visible_lines(text)]
    heads = [i for i, line in enumerate(lines) if line in ('## 最终结论', '## Final Decision')]
    if len(heads) != 1:
        raise ValueError('Exactly one final-decision heading required')
    content = []
    for line in lines[heads[0] + 1:]:
        if re.match(r'^#{1,2}\s', line):
            break
        if line.startswith('<!--'):
            continue
        if line.strip():
            content.append(line.strip())
    if content != ['pass']:
        raise ValueError('Final decision must contain only pass')


def require_no_post_validation_drift(root, change, integrated_revision):
    """After validation, only the active Change may receive close evidence edits."""
    head = revision(root, 'HEAD')
    if not ancestor(root, integrated_revision, head):
        raise ValueError('Current HEAD must descend from the validated integrated revision')
    committed = set()
    if head != integrated_revision:
        committed = set(git(root, 'diff', '--name-only', '-z', integrated_revision, head).split('\0'))
    dirty = set(git(root, 'diff', '--name-only', '-z', 'HEAD').split('\0'))
    dirty |= set(git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'))
    allowed = change.relative_to(root).as_posix().rstrip('/') + '/'
    unexpected = sorted(
        path for path in (committed | dirty) - {''}
        if not path.startswith(allowed)
    )
    if unexpected:
        raise ValueError(
            'Unvalidated project changes exist after integration validation: '
            + ', '.join(unexpected)
        )


def check(root, change_id):
    change, fields, _ = active_change(root, change_id)
    text = read_text(mapped_document(root, change, fields, 'contract'))
    stable, evidence = split_contract(text)
    require_pass(evidence)
    close_fields, _ = metadata(text)
    visible = list(visible_lines(evidence))
    lines = evidence.splitlines(keepends=True)
    headings = [i for i, line in visible if line in ('## 验证结果', '## Verification')]
    if len(headings) != 1:
        raise ValueError('Exactly one verification heading required')
    begin = headings[0]
    end = next((i for i, line in visible if i > begin and re.match(r'^#{1,2}\s', line)), len(lines))
    try:
        require_evidence_body(''.join(lines[begin + 1:end]), 'verification')
    except ValueError as error:
        raise ValueError('Actual verification evidence required') from error
    planning_complete(root, change, fields)
    sha = revision(root, close_fields['integrated_revision'])
    validate_receipt(root, change_id, sha)
    require_no_post_validation_drift(root, change, sha)
    for key in ('product', 'technology', 'operations'):
        value = close_fields.get(key, '').strip()
        if not value or value.lower() in ('pending', 'not reviewed', '待补充', '待核实'):
            raise ValueError('Current Truth assessment required: ' + key)
    if 'graph' in fields:
        _, _, _, graph = context(root, change_id)
        for task in graph['tasks']:
            if task['state'] != 'accepted' or not ancestor(root, task['result_revision'], sha):
                raise ValueError('All accepted results must be included in integrated revision')
            c, f, _, _, _, directory, tf = context(root, change_id, task['id'])
            planning_complete(root, c, f, directory, tf)
            if task.get('contract_digest') != contract_digest(root, c, f, directory, tf):
                raise ValueError('Accepted frozen Contract changed')
            report = read_text(document(root, directory, tf, 'report'))
            if task.get('report_digest') != hashlib.sha256(report.encode()).hexdigest():
                raise ValueError('Accepted report changed')
    return sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('change_id')
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(check(root_path(args.root), args.change_id))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
