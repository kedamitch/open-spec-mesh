"""Move a legacy docs tree aside and create the canonical 01-09 scaffold safely."""
import argparse
from pathlib import Path
import shutil
import sys

PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE / "sdd-init/scripts"))

from init_project import initialize
from numbering import AREAS, locked, atomic, refresh
from sdd_common import root_path, inside


def is_canonical(docs):
    if not docs.is_dir():
        return False
    directories = {path.name for path in docs.iterdir() if path.is_dir()}
    return directories == set(AREAS)


def migration_map(legacy):
    documents = sorted(
        path.relative_to(legacy).as_posix()
        for path in legacy.rglob("*.md")
        if path.is_file() and not path.is_symlink()
    )
    tick = chr(96)
    rows = "\n".join(
        f"| {tick}{path}{tick} | 待迁移 | 待确认 |"
        for path in documents
    )
    if not rows:
        rows = "| 无 Markdown 文档 | 已核实 | 无 |"
    return (
        "# Legacy Documentation Migration\n\n"
        "## Purpose\n\n"
        "记录旧文档事实迁移到当前 01–09 体系的去向。脚本只保存原文件并建立骨架，不猜测语义。\n\n"
        "## Legacy Source\n\n"
        f"{tick}.sdd-migration/legacy-docs/{tick}\n\n"
        "## Migration Map\n\n"
        "| Legacy Document | Status | Canonical Target |\n"
        "| --- | --- | --- |\n"
        + rows
        + "\n\n## Completion\n\n"
        "只有所有真实旧文档都已核对并迁入正确的 Current Truth / ADR / Research / Change，"
        "且 canonical docs 校验通过后，才可把迁移标记为完成。\n"
    )


def migrate(root):
    docs = inside(root, "docs")
    migration_root = inside(root, ".sdd-migration")
    legacy = inside(root, ".sdd-migration/legacy-docs")

    agents = inside(root, "AGENTS.md")
    agents_existed = agents.exists()

    with locked(root):
        if not docs.is_dir() or docs.is_symlink():
            raise ValueError("Legacy migration requires a real docs directory")
        if is_canonical(docs):
            raise ValueError("Project already uses the canonical 01-09 docs layout")
        if migration_root.exists():
            raise ValueError(".sdd-migration already exists; inspect the previous migration before retrying")
        migration_root.mkdir()
        try:
            shutil.move(str(docs), str(legacy))
        except BaseException:
            shutil.rmtree(migration_root, ignore_errors=True)
            raise

    try:
        # initialize() owns the same project lock, so do not call it while holding
        # the migration lock above.
        initialize(root)
        with locked(root):
            target = inside(root, "docs/01-governance/G02-migration-map.md")
            if target.exists():
                raise ValueError("Canonical migration map path is already occupied")
            atomic(target, migration_map(legacy))
            refresh(target.parent)
        return target
    except BaseException:
        with locked(root):
            if docs.exists():
                shutil.rmtree(docs)
            if legacy.exists() and not docs.exists():
                shutil.move(str(legacy), str(docs))
            if migration_root.exists():
                shutil.rmtree(migration_root, ignore_errors=True)
            if not agents_existed and agents.is_file():
                agents.unlink()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path.cwd()))
    args = parser.parse_args()
    try:
        print(migrate(root_path(args.root)))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
