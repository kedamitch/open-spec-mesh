"""Prepare a numbered release folder from completed Changes; never deploy."""
import argparse
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sdd-init/scripts'))
from sdd_common import root_path, inside, read_text, metadata, render_spec
from numbering import locked, allocate, atomic, refresh, title_check

NOTE_TEMPLATE = Path(__file__).resolve().parents[1] / 'references/release-template.md'
CHECKLIST_TEMPLATE = Path(__file__).resolve().parents[1] / 'references/release-checklist-template.md'


def create_release(root, version, title, changes):
    title_check(title)
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('Use a semantic version')
    if not changes or len(set(changes)) != len(changes):
        raise ValueError('Provide unique completed Changes')

    note_content = read_text(NOTE_TEMPLATE)
    checklist_content = read_text(CHECKLIST_TEMPLATE)

    with locked(root):
        parent = inside(root, 'docs/09-delivery/D01-发布记录')
        for directory in parent.iterdir():
            if directory.is_dir():
                fields, _ = metadata(read_text(inside(root, directory.relative_to(root), 'index.md')))
                if fields.get('version') == version:
                    raise ValueError('Version already exists')

        for change_id in changes:
            path = inside(root, 'docs/05-changes/C02-已完成', change_id)
            fields, _ = metadata(read_text(path / 'index.md'))
            if fields.get('status') != 'completed' or fields.get('id') != change_id:
                raise ValueError('Change is not completed')

        directory_title = 'v' + version.replace('.', '-')
        directory = allocate(root, parent, directory_title, directory=True)
        note = allocate(root, directory, 'release-notes', content=note_content)
        checklist = allocate(root, directory, 'release-checklist', content=checklist_content)
        atomic(directory / 'index.md', render_spec(
            {
                'version': version,
                'title': title,
                'changes': ','.join(changes),
                'note': note.name,
                'checklist': checklist.name,
            },
            '\n# ' + title + '\n',
        ))
        refresh(directory)
        return directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    parser.add_argument('title')
    parser.add_argument('--changes', nargs='+', required=True)
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(create_release(root_path(args.root), args.version, args.title, args.changes))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
