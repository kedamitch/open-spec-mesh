"""Check release references, completed checklist and explicit readiness verdict, without publishing."""
import argparse
from pathlib import Path
import re
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE / 'sdd-init/scripts'), str(PACKAGE / 'sdd-close/scripts')]
from sdd_common import root_path, inside, metadata, read_text
from check_change import require_pass
from markdown_contract import visible_lines

REQUIRED_CHECKLIST = (
    'Build', 'Tests', 'Database', 'Configuration',
    'Documentation', 'Deployment', 'Rollback',
)


def require_checklist(text):
    visible = '\n'.join(line for _, line in visible_lines(text))
    for heading in REQUIRED_CHECKLIST:
        if not re.search(r'^##\s+' + re.escape(heading) + r'\s*$', visible, re.M):
            raise ValueError('Release checklist missing section: ' + heading)
    if re.search(r'^\s*-\s*\[\s\]\s+', visible, re.M):
        raise ValueError('Release checklist still has unchecked items')


def check(root, relative):
    directory = inside(root, relative)
    fields, _ = metadata(read_text(directory / 'index.md'))
    for change_id in fields['changes'].split(','):
        cf, _ = metadata(read_text(
            inside(root, 'docs/05-changes/C02-已完成', change_id, 'index.md')))
        if cf.get('status') != 'completed' or cf.get('id') != change_id:
            raise ValueError('Release references incomplete Change')

    require_pass(read_text(inside(root, directory.relative_to(root), fields['note'])))
    require_checklist(read_text(
        inside(root, directory.relative_to(root), fields['checklist'])))
    return fields['version']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(check(root_path(args.root), args.directory))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
