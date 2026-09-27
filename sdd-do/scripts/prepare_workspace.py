"""Main dispatches or reuses a worktree; synchronize contracts, never implementation."""
import argparse
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PACKAGE/'sdd-init/scripts'), str(PACKAGE/'sdd-change/scripts')]
from sdd_common import root_path, inside, read_text, metadata
from numbering import locked, atomic
from workflow import context, contract_digest, git, revision, ancestor, event, save_graph, document, planning_complete


def shared_worktree(root, location):
    """Only trust an existing registered worktree of this exact repository."""
    for part in (location, *location.parents):
        if part.is_symlink(): raise ValueError('Workspace must not use symlinks')
    location = location.resolve()
    registered = {Path(line[9:]).resolve() for line in git(root, 'worktree', 'list', '--porcelain').splitlines()
                  if line.startswith('worktree ')}
    if location not in registered:
        raise ValueError('Workspace is not registered in this repository')
    return location


def planning_paths(root, change, fields, gp, graph):
    """All canonical planning/report artifacts for the complete frozen Graph."""
    task_root = document(root, change, fields, 'tasks')
    paths = {
        str(p.relative_to(root))
        for p in (
            change/'index.md',
            document(root, change, fields, 'contract'),
            task_root/'index.md',
            gp,
        )
    }
    if 'design' in fields:
        paths.add(str(document(root, change, fields, 'design').relative_to(root)))
    for item in graph['tasks']:
        task_dir = inside(root, change.relative_to(root), item['path'])
        task_fields, _ = metadata(read_text(task_dir/'index.md'))
        paths.add(str((task_dir/'index.md').relative_to(root)))
        paths.add(str(document(root, task_dir, task_fields, 'contract').relative_to(root)))
        paths.add(str(document(root, task_dir, task_fields, 'report').relative_to(root)))
    return paths


def unexpected_workspace_edits(root, location, change, fields, gp, graph):
    """Return dirty paths outside canonical planning/report artifacts for this Graph."""
    dirty = set(git(location, 'diff', '--name-only', '-z', 'HEAD').split('\0'))
    dirty |= set(git(location, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'))
    return dirty - planning_paths(root, change, fields, gp, graph) - {''}


def require_dispatchable_workspace(root, location, change, fields, gp, graph):
    unexpected = unexpected_workspace_edits(root, location, change, fields, gp, graph)
    if unexpected:
        raise ValueError(
            'Commit or preserve implementation edits before dispatch; unrelated paths: '
            + ', '.join(sorted(unexpected))
        )


def sync_files(root, change, fields, gp, directory, tf, location, graph):
    """Mirror only known planning files plus a read-only scheduler snapshot.

    The Worker delivery file is never overwritten. Roll back exactly the files
    written here on failure; implementation files are never inspected or changed.
    """
    sources = [change/'index.md', document(root, change, fields, 'contract'),
               directory.parent/'index.md', directory/'index.md', document(root, directory, tf, 'contract')]
    if 'design' in fields: sources.append(document(root, change, fields, 'design'))
    deliveries = document(root, directory, tf, 'report')
    destination_report = inside(location, deliveries.relative_to(root))
    if not destination_report.exists(): sources.append(deliveries)
    writes = [(inside(location, src.relative_to(root)), read_text(src)) for src in sources]
    graph_target = inside(location, gp.relative_to(root))
    previous = []
    try:
        for target, text in writes:
            target.parent.mkdir(parents=True, exist_ok=True)
            old = target.read_text(encoding='utf-8') if target.exists() else None
            previous.append((target, old))
            atomic(target, text)
        old = graph_target.read_text(encoding='utf-8') if graph_target.exists() else None
        previous.append((graph_target, old))
        save_graph(graph_target, graph)
        return previous
    except BaseException:
        restore_files(previous)
        raise


def restore_files(previous):
    for target, old in reversed(previous):
        if old is None: target.unlink(missing_ok=True)
        else: atomic(target, old)


def prepare(root, change_id, task_id, base='HEAD', worktree=None, reuse=False):
    with locked(root):
        change, fields, gp, graph, task, directory, tf = context(root, change_id, task_id)
        if task['state'] != 'planned' or task.get('contract_digest') != contract_digest(root, change, fields, directory, tf):
            raise ValueError('Main must approve the current Contract first')
        planning_complete(root, change, fields, directory, tf)
        sha = revision(root, base)
        for dep in task['depends_on']:
            upstream = next(t for t in graph['tasks'] if t['id'] == dep)
            if upstream['state'] != 'accepted' or not ancestor(root, upstream['result_revision'], sha):
                raise ValueError('Baseline must contain accepted dependency code')
        requested = worktree or (task.get('workspace') if reuse else None)
        location = Path(requested).absolute() if requested else root
        for part in (location, *location.parents):
            if part.is_symlink(): raise ValueError('Workspace must not use symlinks')
        location = location.resolve()
        if any(t['state'] in ('running', 'submitted') and t.get('workspace') == str(location) for t in graph['tasks']):
            raise ValueError('Active writer already uses this workspace')
        created = False
        previous = []
        try:
            if location != root:
                if location.exists():
                    if not reuse or task.get('workspace') != str(location):
                        raise ValueError('Reuse requires --reuse and the Task\'s original workspace')
                    shared_worktree(root, location)
                    if revision(location, 'HEAD') != sha:
                        raise ValueError('Integrate dependencies into the original worktree first; pass its HEAD as --base')
                    require_dispatchable_workspace(
                        root, location, change, fields, gp, graph
                    )
                else:
                    if reuse: raise ValueError('Original worktree is missing')
                    git(root, 'worktree', 'add', '--detach', str(location), sha)
                    created = True
            elif revision(root, 'HEAD') != sha:
                raise ValueError('Current checkout differs from baseline')
            else:
                require_dispatchable_workspace(
                    root, location, change, fields, gp, graph
                )
            task.update(workspace=str(location), baseline=sha, attempt=task.get('attempt', 0) + 1)
            event(task, 'running', baseline=sha, workspace=str(location), attempt=task['attempt'])
            if location != root:
                previous = sync_files(root, change, fields, gp, directory, tf, location, graph)
            save_graph(gp, graph)
        except BaseException:
            restore_files(previous)
            if created:
                # Only this newly-created, not-yet-dispatched scratch worktree is removed.
                git(root, 'worktree', 'remove', '--force', str(location))
            raise
        return location


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('change_id'); parser.add_argument('task_id')
    parser.add_argument('--root', default=str(Path.cwd()))
    parser.add_argument('--base', default='HEAD'); parser.add_argument('--worktree')
    parser.add_argument('--reuse', action='store_true')
    args = parser.parse_args()
    try:
        print(prepare(root_path(args.root), args.change_id, args.task_id, args.base, args.worktree, args.reuse))
    except (OSError, ValueError) as exc: parser.exit(1, str(exc) + '\n')


if __name__ == '__main__': main()
