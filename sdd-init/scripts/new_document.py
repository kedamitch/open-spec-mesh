"""Create a numbered Markdown document or directory."""
import argparse
from pathlib import Path
import re
from sdd_common import root_path, inside
from numbering import allocate, locked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('parent'); parser.add_argument('title')
    parser.add_argument('--directory', action='store_true')
    parser.add_argument('--root', default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        if not args.directory and not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,79}', args.title):
            raise ValueError('Document filename must be an English slug')
        root = root_path(args.root)
        with locked(root): print(allocate(root, inside(root, args.parent), args.title, directory=args.directory))
    except (OSError, ValueError) as exc: parser.exit(1, str(exc) + '\n')


if __name__ == '__main__': main()
