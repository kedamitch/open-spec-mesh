"""Create a numbered ADR from the maintained template; no model call."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sdd-init/scripts'))
from sdd_common import root_path, inside, read_text
from numbering import locked, allocate, title_check

TEMPLATE = Path(__file__).resolve().parents[1] / 'references/adr-template.md'


def create_adr(root, title):
    title_check(title)
    template = read_text(TEMPLATE)
    if not template.startswith('# ') or '\n' not in template:
        raise ValueError('ADR template requires a title and body')
    content = '# ' + title + '\n' + template.split('\n', 1)[1]
    with locked(root):
        return allocate(root, inside(root, 'docs/06-decisions'), 'decision', content=content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('title')
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(create_adr(root_path(args.root), args.title))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
