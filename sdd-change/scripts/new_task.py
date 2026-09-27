"""Create a canonical C03 Task with local design and Delivery report."""
import argparse
import os
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE / 'sdd-init/scripts'), str(PACKAGE / 'sdd-change/scripts')]

from sdd_common import active_change, root_path, render_spec
from numbering import locked, allocate, atomic, refresh, title_check
from workflow import save_graph, document
from task_graph import load_graph

TASK_TEMPLATE = Path(__file__).resolve().parents[1] / 'references/sdd-task-contract-template.md'


def create_task(root, change_id, title, dependencies=()):
    title_check(title)
    with locked(root):
        change, fields, body = active_change(root, change_id)
        required = {'contract', 'design', 'tasks', 'graph'}
        if not required <= set(fields):
            raise ValueError('Change does not use the canonical C01/C02/C03 layout')
        if len(set(dependencies)) != len(dependencies):
            raise ValueError('Duplicate dependencies')

        graph_path = document(root, change, fields, 'graph')
        graph = load_graph(graph_path)
        known = {task['id'] for task in graph['tasks']}
        if any(dep not in known for dep in dependencies):
            raise ValueError('Unknown dependency')

        task_root = document(root, change, fields, 'tasks')
        directory = allocate(root, task_root, title, directory=True)
        task_id = directory.name.rsplit('-' + title, 1)[0]
        design_path = os.path.relpath(document(root, change, fields, 'design'), directory)
        contract = (
            TASK_TEMPLATE.read_text(encoding='utf-8')
            .replace('DESIGN_PATH', design_path)
            .replace('TASK_ID', task_id)
        )

        task_fields = {'id': task_id}
        task_fields['contract'] = allocate(root, directory, 'task', content=contract).name
        task_fields['report'] = allocate(
            root, directory, 'delivery',
            content='# Task Delivery\n\n尚未交付。Worker 完成实现、验证和自审后写入。\n').name
        atomic(directory / 'index.md', render_spec(task_fields, '\n# ' + title + '\n'))
        refresh(directory)

        graph['tasks'].append({
            'id': task_id,
            'path': str(directory.relative_to(change)),
            'depends_on': list(dependencies),
            'state': 'planned',
            'history': [],
        })
        save_graph(graph_path, graph)
        fields['updated'] = fields.get('updated', '')
        atomic(change / 'index.md', render_spec(fields, body))
        refresh(task_root)
        refresh(change)
        return directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('change_id')
    parser.add_argument('title')
    parser.add_argument('--depends-on', nargs='*', default=[])
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(create_task(root_path(args.root), args.change_id, args.title, args.depends_on))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
