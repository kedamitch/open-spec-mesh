"""Safe structural migration from legacy docs to the canonical 01-09 layout."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [
    str(ROOT / "sdd-init/scripts"),
    str(ROOT / "sdd-migrate/scripts"),
]

import migrate_project
import validate_docs
from numbering import AREAS


class SddMigrateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def legacy(self):
        docs = self.root / "docs"
        (docs / "01-prd").mkdir(parents=True)
        (docs / "06-design").mkdir(parents=True)
        (docs / "01-prd/product.md").write_bytes(b"# Product\nlegacy product fact\n")
        (docs / "06-design/change.md").write_bytes(b"# Design\nlegacy design fact\n")
        return docs

    def test_migrate_preserves_legacy_bytes_and_creates_canonical_scaffold(self):
        self.legacy()
        target = migrate_project.migrate(self.root)

        self.assertEqual(
            set(AREAS),
            {path.name for path in (self.root / "docs").iterdir() if path.is_dir()},
        )
        legacy = self.root / ".sdd-migration/legacy-docs"
        self.assertEqual(
            b"# Product\nlegacy product fact\n",
            (legacy / "01-prd/product.md").read_bytes(),
        )
        self.assertEqual(
            b"# Design\nlegacy design fact\n",
            (legacy / "06-design/change.md").read_bytes(),
        )
        mapping = target.read_text()
        self.assertIn("01-prd/product.md", mapping)
        self.assertIn("06-design/change.md", mapping)
        self.assertIn("待迁移", mapping)
        self.assertEqual([], validate_docs.validate(self.root))

    def test_canonical_project_is_rejected_without_mutation(self):
        from init_project import initialize
        initialize(self.root)
        before = {
            str(path.relative_to(self.root)): path.read_bytes()
            for path in self.root.rglob("*")
            if path.is_file()
        }
        with self.assertRaisesRegex(ValueError, "already uses the canonical"):
            migrate_project.migrate(self.root)
        after = {
            str(path.relative_to(self.root)): path.read_bytes()
            for path in self.root.rglob("*")
            if path.is_file()
        }
        self.assertEqual(before, after)

    def test_existing_migration_marker_fails_closed(self):
        self.legacy()
        marker = self.root / ".sdd-migration"
        marker.mkdir()
        before = (self.root / "docs/01-prd/product.md").read_bytes()
        with self.assertRaisesRegex(ValueError, "already exists"):
            migrate_project.migrate(self.root)
        self.assertEqual(before, (self.root / "docs/01-prd/product.md").read_bytes())

    def test_initial_move_failure_removes_migration_marker(self):
        self.legacy()
        with patch.object(migrate_project.shutil, "move", side_effect=OSError("move failed")):
            with self.assertRaisesRegex(OSError, "move failed"):
                migrate_project.migrate(self.root)
        self.assertTrue((self.root / "docs/01-prd/product.md").is_file())
        self.assertFalse((self.root / ".sdd-migration").exists())

    def test_initialize_failure_restores_legacy_docs(self):
        self.legacy()
        with patch.object(migrate_project, "initialize", side_effect=ValueError("boom")):
            with self.assertRaisesRegex(ValueError, "boom"):
                migrate_project.migrate(self.root)
        self.assertTrue((self.root / "docs/01-prd/product.md").is_file())
        self.assertFalse((self.root / ".sdd-migration").exists())
        self.assertFalse((self.root / "AGENTS.md").exists())


if __name__ == "__main__":
    unittest.main()
