"""Initialization repairs missing slots and indexes, without overwriting facts or rules."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'sdd-init/scripts'))
import init_project


class ScaffoldRepairTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_all_new_files_appear_in_parent_indexes(self):
        init_project.initialize(self.root)
        for relative in init_project.FILES:
            path = self.root / 'docs' / relative
            self.assertIn('](' + path.name + ')', (path.parent / 'index.md').read_text())

    def test_current_scaffold_contains_full_product_and_technical_baseline(self):
        init_project.initialize(self.root)
        product = (self.root / 'docs/02-product/P01-product-overview.md').read_text()
        modules = (self.root / 'docs/02-product/P02-modules/index.md').read_text()
        api = (self.root / 'docs/03-architecture/T02-api.md').read_text()
        database = (self.root / 'docs/03-architecture/T03-database.md').read_text()
        domain = (self.root / 'docs/03-architecture/T04-domain-model.md').read_text()
        product_diagram = (self.root / 'docs/02-product/P03-diagrams/P03-01-product-architecture.md').read_text()
        sequence = (self.root / 'docs/03-architecture/T05-diagrams/T05-03-main-sequence.md').read_text()

        for value in ('产品定位与边界', '用户与核心场景', '产品架构', '模块总览', '核心业务流程', '跨模块业务规则'):
            self.assertIn(value, product)
        for value in ('模块清单', '核心能力'):
            self.assertIn(value, modules)
        self.assertIn('API List', api)
        self.assertIn('Request', api)
        self.assertIn('Table List', database)
        self.assertIn('Columns', database)
        self.assertIn('Domain Overview', domain)
        self.assertIn('State Machines', domain)
        self.assertIn('flowchart', product_diagram)
        self.assertIn('sequenceDiagram', sequence)

    def test_missing_diagram_slot_does_not_conflict_with_siblings(self):
        init_project.initialize(self.root)
        path = self.root / 'docs/03-architecture/T05-diagrams/T05-03-main-sequence.md'
        path.unlink()
        preserved = self.root / 'docs/03-architecture/T05-diagrams/T05-02-application-architecture.md'
        preserved.write_text('# 已核实事实\n保留人工修改。\n')
        init_project.initialize(self.root)
        self.assertTrue(path.is_file())
        self.assertEqual('# 已核实事实\n保留人工修改。\n', preserved.read_text())
        self.assertIn(path.name, (path.parent / 'index.md').read_text())

    def test_same_full_slot_collision_is_nondestructive(self):
        init_project.initialize(self.root)
        path = self.root / 'docs/03-architecture/T05-diagrams/T05-03-main-sequence.md'
        path.rename(path.with_name('T05-03-custom.md'))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'Number occupied'):
            init_project.initialize(self.root)
        self.assertEqual(before, self.snapshot())

    def test_project_rules_read_template_without_global_role_duplication(self):
        init_project.initialize(self.root)
        rules = (self.root / 'AGENTS.md').read_text()
        self.assertEqual(init_project.PROJECT_AGENTS_TEMPLATE.read_text(), rules)
        self.assertNotIn('Architect', rules)
        self.assertNotIn('Complex', rules)

    def test_existing_user_rules_preserved(self):
        (self.root / 'AGENTS.md').write_text('# 用户约定\n只在授权分支操作。\n')
        init_project.initialize(self.root)
        self.assertEqual('# 用户约定\n只在授权分支操作。\n', (self.root / 'AGENTS.md').read_text())

    def test_missing_project_template_does_not_half_initialize(self):
        with patch.object(init_project, 'PROJECT_AGENTS_TEMPLATE', self.root / 'absent.md'):
            with self.assertRaises((OSError, ValueError)):
                init_project.initialize(self.root)
        self.assertEqual({}, self.snapshot())
        self.assertFalse((self.root / 'docs').exists())


if __name__ == '__main__':
    unittest.main()
