"""Validate Markdown layout and links; code examples do not count as live links."""
import argparse
from pathlib import Path
import re
from sdd_common import root_path, metadata, read_text
from numbering import AREAS, prefix, title_check
from markdown_contract import visible_lines


def runtime_graph(path):
    if path.name != 'C03-task-graph.json':
        return False
    if path.parent.name != 'C03-tasks':
        return False
    change = path.parent.parent
    if not re.fullmatch(r'CHG-\d{8}-.+', change.name):
        return False
    try:
        fields, _ = metadata(read_text(change / 'index.md'))
        return fields.get('graph') == 'C03-tasks/C03-task-graph.json'
    except (OSError, ValueError):
        return False


def validate(root):
    docs = root/'docs'; errors = []
    if not docs.is_dir() or docs.is_symlink(): return ['docs must be a real directory']
    if any(p.name != 'index.md' and not p.is_dir() for p in docs.iterdir()):
        errors.append('Only index.md and categories allowed at docs root')
    if {p.name for p in docs.iterdir() if p.is_dir()} != set(AREAS):
        errors.append('Expected consecutive 01–09 categories')
    for directory in [docs, *sorted(p for p in docs.rglob('*') if p.is_dir())]:
        if directory.is_symlink(): errors.append(f'Symlink: {directory}'); continue
        if not (directory/'index.md').is_file(): errors.append(f'Missing index: {directory}')
        if directory == docs: continue
        try: stem = prefix(root, directory)
        except ValueError as exc: errors.append(str(exc)); continue
        lead = stem if len(stem) == 1 else stem+'-'
        width = 3 if stem == 'ADR' else 2
        seen = set()
        for child in directory.iterdir():
            if child.is_symlink(): errors.append(f'Symlink: {child}'); continue
            if child.name == 'index.md': continue
            if child.is_file() and runtime_graph(child):
                continue
            if child.is_file() and child.suffix != '.md':
                errors.append(f'Non-Markdown document: {child}')
            if directory.name in ('C01-进行中', 'C02-已完成') and child.is_dir() and re.fullmatch(r'CHG-\d{8}-.+', child.name):
                title = child.name[13:]
            else:
                match = re.fullmatch(re.escape(lead)+rf'(\d{{{width}}})-(.+)', child.name)
                if not match: errors.append(f'Invalid numbering: {child}'); continue
                if match[1] in seen or int(match[1]) == 0: errors.append(f'Duplicate/zero number: {child}')
                seen.add(match[1]); title = match[2] if child.is_dir() else Path(match[2]).stem
            if child.is_file() and not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*', title):
                errors.append(f'Document filename must be English: {child}')
            try: title_check(title)
            except ValueError: errors.append(f'Invalid title: {child}')
    for path in docs.rglob('*.md'):
        if path.is_symlink(): continue
        try:
            for _, line in visible_lines(path.read_text(encoding='utf-8')):
                for target in re.findall(r'\]\(([^)]+)\)', line):
                    if '://' in target or target.startswith(('#', 'mailto:')): continue
                    target = target.split('#')[0]
                    if target and not (path.parent/target).exists(): errors.append(f'Broken link: {path}: {target}')
        except ValueError as exc: errors.append(f'{path}: {exc}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(Path.cwd())); args = parser.parse_args()
    errors = validate(root_path(args.root))
    if errors: parser.exit(1, '\n'.join(errors)+'\n')
    print('docs: valid')


if __name__ == '__main__': main()
