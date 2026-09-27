"""Main imports exactly one assigned worktree's delivery and submits that Task."""
import argparse
from pathlib import Path
import sys
PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE/'sdd-init/scripts'), str(PACKAGE/'sdd-change/scripts')]
from sdd_common import root_path, read_text
from numbering import locked, atomic
from workflow import context, contract_digest, document, validate_delivery, transition
from prepare_workspace import shared_worktree


def import_delivery(root, change_id, task_id, source):
    with locked(root):
        change, fields, _, _, task, directory, tf = context(root, change_id, task_id)
        location = shared_worktree(root, Path(source).absolute())
        if str(location) != task.get('workspace'):
            raise ValueError('Delivery source is not this Task\'s assigned workspace')
        expected = contract_digest(root, change, fields, directory, tf)
        if task['state'] != 'running' or expected != task.get('contract_digest'):
            raise ValueError('Current Task is not running against its frozen Contract')
        wc, wf, _, _, wt, wd, wtf = context(location, change_id, task_id)
        if contract_digest(location, wc, wf, wd, wtf) != expected:
            raise ValueError('Worker workspace contract is stale or modified')
        if wt.get('attempt') != task.get('attempt') or wt.get('baseline') != task.get('baseline'):
            raise ValueError('Worker scheduler snapshot belongs to an old dispatch')
        report = read_text(document(location, wd, wtf, 'report'))
        task_contract_path = document(root, directory, tf, 'contract')
        validate_delivery(
            root, task, report, read_text(task_contract_path),
            str(task_contract_path.relative_to(root)),
        )  # Commits are resolved in Main's repository.
        destination = document(root, directory, tf, 'report')
        old = read_text(destination)
        try:
            atomic(destination, report)
            return transition(root, change_id, task_id, 'submit')
        except BaseException:
            atomic(destination, old)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('change_id'); parser.add_argument('task_id')
    parser.add_argument('--from-workspace', required=True, type=Path)
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try: print(import_delivery(root_path(args.root), args.change_id, args.task_id, args.from_workspace))
    except (OSError, ValueError) as exc: parser.exit(1, str(exc) + '\n')


if __name__ == '__main__': main()
