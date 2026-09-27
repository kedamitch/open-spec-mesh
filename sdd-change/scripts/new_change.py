"""Create the canonical numbered SDD Change scaffold. Quick changes do not call this script."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sdd-init/scripts'))
from sdd_common import root_path, inside, today, create_text, render_spec
from numbering import title_check, locked, allocate, refresh, atomic

TEMPLATES = Path(__file__).resolve().parents[1] / 'references'


def create_change(root, title):
    title_check(title)
    with locked(root):
        change_id = 'CHG-' + today().replace('-', '') + '-' + title
        active = inside(root, 'docs/05-changes/C01-进行中')
        if not active.is_dir():
            raise ValueError('Run sdd-init first')
        if inside(root, 'docs/05-changes/C02-已完成', change_id).exists():
            raise ValueError('Change already completed')

        change = inside(root, active.relative_to(root), change_id)
        change.mkdir()
        create_text(change / 'index.md', '# ' + title + '\n')

        fields = {
            'id': change_id,
            'status': 'active',
            'created': today(),
            'updated': today(),
        }
        fields['contract'] = allocate(
            root, change, 'change',
            content=(TEMPLATES / 'change-template.md').read_text(encoding='utf-8')).name
        fields['design'] = allocate(
            root, change, 'design',
            content=(TEMPLATES / 'design-template.md').read_text(encoding='utf-8')).name
        tasks = allocate(root, change, 'tasks', directory=True)
        fields['tasks'] = tasks.name

        graph_name = tasks.name.split('-tasks', 1)[0] + '-task-graph.json'
        create_text(tasks / graph_name, '{"tasks": []}\n')
        fields['graph'] = tasks.name + '/' + graph_name

        atomic(change / 'index.md', render_spec(fields, '\n# ' + title + '\n'))
        refresh(tasks)
        refresh(change)
        refresh(active)
        return change


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('title')
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(create_change(root_path(args.root), args.title))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
