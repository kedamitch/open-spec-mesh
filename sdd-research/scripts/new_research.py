"""Create research from its single maintained Markdown template; no external lookup."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sdd-init/scripts'))
from sdd_common import root_path, inside, read_text
from numbering import locked, allocate, title_check

TEMPLATE = Path(__file__).resolve().parents[1] / 'references/research-template.md'


def create_research(root, title):
    title_check(title)
    content = read_text(TEMPLATE)  # Validate inputs before allocating a numbered directory.
    with locked(root):
        directory = allocate(root, inside(root, 'docs/07-research'), title, directory=True)
        allocate(root, directory, 'research-report', content=content)
        return directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('title')
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(create_research(root_path(args.root), args.title))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
