"""Return the canonical C02 Design document for an active Change."""
import argparse
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE / 'sdd-init/scripts'))

from sdd_common import root_path, active_change, mapped_document


def ensure(root, change_id):
    change, fields, _ = active_change(root, change_id)
    design = mapped_document(root, change, fields, 'design')
    if design.name != 'C02-design.md':
        raise ValueError('Canonical Design must be C02-design.md')
    return design


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('change_id')
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(ensure(root_path(args.root), args.change_id))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
