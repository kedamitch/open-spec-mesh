"""Worker replaces its current evidence report; never mutates scheduler state."""
import argparse
from pathlib import Path
import sys
PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE/'sdd-init/scripts'), str(PACKAGE/'sdd-change/scripts')]
from sdd_common import root_path, read_text, render_spec
from numbering import locked, atomic
from workflow import context, document, contract_digest, revision, ancestor
from delivery_evidence import validate_evidence


def deliver(root, change_id, task_id, result, evidence, attempt):
    with locked(root):
        change, fields, _, _, task, directory, tf = context(root, change_id, task_id)
        digest = contract_digest(root, change, fields, directory, tf)
        if task['state'] != 'running' or task.get('contract_digest') != digest:
            raise ValueError('Task is not running with the frozen Contract')
        sha = revision(root, result)
        if not ancestor(root, task['baseline'], sha): raise ValueError('Result must descend from assigned baseline')
        if Path(task['workspace']).resolve() != root.resolve():
            raise ValueError('Delivery must be written in the assigned workspace')
        if attempt != task.get('attempt'):
            raise ValueError('Stale assigned attempt; request a new dispatch before recording')
        task_contract_path = document(root, directory, tf, 'contract')
        task_contract = read_text(task_contract_path)
        validate_evidence(
            root, task['baseline'], sha, evidence,
            task_contract=task_contract,
            label=str(task_contract_path.relative_to(root)),
        )
        report = document(root, directory, tf, 'report')
        # Current report only: prior revisions remain in Git and the Main graph history.
        fields = {'status': 'submitted', 'revision': sha, 'attempt': str(task.get('attempt', 0)),
                  'contract_digest': digest, 'baseline': task['baseline']}
        atomic(report, render_spec(fields, '\n# 任务交付报告\n\n' + evidence.strip() + '\n'))
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('change_id'); parser.add_argument('task_id')
    parser.add_argument('--revision', required=True); parser.add_argument('--evidence-file', type=Path, required=True)
    parser.add_argument('--attempt', required=True, type=int)
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(deliver(root_path(args.root), args.change_id, args.task_id, args.revision, read_text(args.evidence_file), args.attempt))
    except (OSError, ValueError) as exc: parser.exit(1, str(exc) + '\n')


if __name__ == '__main__': main()
