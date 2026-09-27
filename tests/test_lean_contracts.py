"""Behavior regressions for actual template generation and non-placeholder delivery evidence."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
for skill in ('sdd-init', 'sdd-change', 'sdd-do', 'sdd-close', 'sdd-research', 'sdd-release'):
    sys.path.insert(0, str(ROOT / skill / 'scripts'))
import init_project
import new_change
import new_task
import ensure_design
import new_research
import new_adr
import new_release
import check_change
from sdd_common import metadata, render_spec
from delivery_evidence import validate_evidence, require_evidence_body
from path_contract import validate_changed_paths


class TemplateGenerationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        init_project.initialize(self.root)

    def test_change_and_task_use_canonical_numbered_templates(self):
        change = new_change.create_change(self.root, 'canonical-template')
        fields, _ = metadata((change / 'index.md').read_text())
        self.assertEqual('C01-change.md', fields['contract'])
        self.assertEqual('C02-design.md', fields['design'])
        self.assertEqual('C03-tasks', fields['tasks'])
        self.assertEqual('C03-tasks/C03-task-graph.json', fields['graph'])
        self.assertEqual(
            (ROOT / 'sdd-change/references/change-template.md').read_text(),
            (change / fields['contract']).read_text())
        self.assertEqual(
            (ROOT / 'sdd-change/references/design-template.md').read_text(),
            (change / fields['design']).read_text())
        self.assertTrue((change / fields['graph']).is_file())

        task = new_task.create_task(self.root, change.name, 'backend')
        task_fields, _ = metadata((task / 'index.md').read_text())
        actual = (task / task_fields['contract']).read_text()
        self.assertTrue(task.name.startswith('C03-'))
        self.assertTrue(task_fields['contract'].startswith(task_fields['id'] + '-01-'))
        self.assertTrue(task_fields['report'].startswith(task_fields['id'] + '-02-'))
        self.assertIn('# Task `' + task_fields['id'] + '`：详细设计', actual)
        self.assertIn('../../C02-design.md', actual)
        self.assertIn('## 详细设计', actual)
        self.assertIn('### 前置任务', actual)
        self.assertIn('### 关联设计', actual)
        self.assertIn('### 验收标准', actual)
        self.assertIn('### Expected Output', actual)

    def test_primary_sdd_templates_are_human_reviewable(self):
        change = (ROOT / 'sdd-change/references/change-template.md').read_text()
        design = (ROOT / 'sdd-change/references/design-template.md').read_text()
        task = (ROOT / 'sdd-change/references/sdd-task-contract-template.md').read_text()

        self.assertIn('> **目标**：待补充。', change)
        self.assertIn('### AC-01｜待补充', change)
        self.assertIn('> **设计结论**：待补充。', design)
        for heading in ('## Current 基线与变更范围', '## 总体方案与主流程', '## 产品变更', '## 接口变更', '## 领域模型与状态变更', '## 数据与表结构变更', '## 应用与组件变更', '## 风险与未决问题'):
            self.assertIn(heading, design)
        self.assertIn('sequenceDiagram', design)
        self.assertIn('| Task | 交付结果 | 前置任务 | 关联设计 | 验收 |', design)
        for heading in ('## 产品变更', '## 接口变更', '## 领域模型与状态变更',
                        '## 数据与表结构变更', '## 应用与组件变更'):
            self.assertIn(heading + '\n\n待补充。', design)
        self.assertNotIn('| 表 / 存储 | Current | Delta / Target | 数据迁移 / 兼容 |', design)
        self.assertIn('> **交付目标**：待补充。', task)
        for heading in ('## 范围与代码落点', '### 输入 / 依赖', '### Path Contract', '### 代码结构 / 模块落点', '## Task 实现流程', '### Components', '### 接口变化', '### 领域模型 / 状态变化', '### 数据与表结构变化', '### Tests', '### Expected Output'):
            self.assertIn(heading, task)
        self.assertIn('flowchart', task)
        for heading in ('### Components', '### 接口变化', '### 领域模型 / 状态变化',
                        '### 数据与表结构变化'):
            self.assertIn(heading + '\n\n待补充。', task)
        self.assertNotIn('| 表 / 存储 | 字段 / 索引 / 约束 | 操作 | 影响 |', task)
        self.assertIn('| 规则 | 路径 |', task)
        self.assertIn('| allow | 待补充 |', task)
        self.assertIn('只运行当前 Task 直接相关的定向测试', task)
        for heading in ('### 前置任务', '### 关联设计', '### 验收标准', '### 验证要求'):
            self.assertIn(heading, task)

        self.assertNotIn('depends_on：待补充。', task)
        self.assertNotIn('AC：待补充。', task)
        self.assertNotIn('Design：待补充。', task)
        self.assertNotIn('| Task | 独立产出 | Design | depends_on | AC |', design)

    def test_new_task_has_no_legacy_from_change_parameter(self):
        change = new_change.create_change(self.root, 'canonical-only')
        with self.assertRaises(TypeError):
            new_task.create_task(self.root, change.name, 'implementation', from_change=True)

    def test_research_uses_template_bytes(self):
        directory = new_research.create_research(self.root, 'evidence')
        report = next(directory.glob('*-research-report.md'))
        self.assertEqual(new_research.TEMPLATE.read_text(), report.read_text())

    def test_adr_changes_only_title(self):
        report = new_adr.create_adr(self.root, '选择已有事务边界')
        expected = '# 选择已有事务边界\n' + new_adr.TEMPLATE.read_text().split('\n', 1)[1]
        self.assertEqual(expected, report.read_text())
        self.assertTrue(report.name.endswith('-decision.md'))

    def test_release_uses_template_bytes(self):
        name = 'CHG-20260922-template-fixture'
        completed = self.root / 'docs/05-changes/C02-已完成' / name
        completed.mkdir()
        (completed / 'index.md').write_text(render_spec({'id': name, 'status': 'completed'}, '# 测试夹具\n'))
        directory = new_release.create_release(self.root, '1.2.3', 'template-release', [name])
        fields, _ = metadata((directory / 'index.md').read_text())
        self.assertEqual(new_release.NOTE_TEMPLATE.read_text(), (directory / fields['note']).read_text())
        self.assertEqual(new_release.CHECKLIST_TEMPLATE.read_text(),
                         (directory / fields['checklist']).read_text())

    def test_missing_template_fails_before_allocation(self):
        before = sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
        with patch.object(new_research, 'TEMPLATE', self.root / 'missing.md'):
            with self.assertRaises((OSError, ValueError)):
                new_research.create_research(self.root, 'missing-source')
        self.assertEqual(before, sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')))


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Evidence Test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('commit', '--allow-empty', '-qm', 'baseline')
        self.base = self.git('rev-parse', 'HEAD')
        (self.root / 'app.py').write_text('value = 1\n')
        self.git('add', 'app.py')
        self.git('commit', '-qm', 'implementation')
        self.result = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.root), *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    def evidence(self, files=None, verification='AC-01: isolated test passed'):
        table = files if files is not None else '| `app.py` | A | Added the validated value |'
        return ('## 文件改动\n\n' + table + '\n\n## 验证结果\n\n' + verification
                + '\n\n## 自审结论\n\nChecked the diff.\n\n## 剩余问题\n\n无。'
                + '\n\n## 快照影响\n\n无，测试夹具。\n')

    def path_contract(self, allow='app.py', deny='无'):
        return (
            '# Task `T1`：详细设计\n\n'
            '## 范围与代码落点\n\n'
            '### Path Contract\n\n'
            '| 规则 | 路径 |\n'
            '| --- | --- |\n'
            f'| allow | `{allow}` |\n'
            + (f'| deny | `{deny}` |\n' if deny != '无' else '| deny | 无 |\n')
        )

    def test_path_contract_accepts_allowed_diff_and_rejects_outside_or_denied(self):
        contract = self.path_contract()
        self.assertEqual({'app.py': 'A'}, validate_evidence(
            self.root, self.base, self.result, self.evidence(),
            task_contract=contract, label='T1'))
        with self.assertRaisesRegex(ValueError, 'outside allow paths'):
            validate_evidence(
                self.root, self.base, self.result, self.evidence(),
                task_contract=self.path_contract('src/**'), label='T1')
        with self.assertRaisesRegex(ValueError, 'denied by app.py'):
            validate_evidence(
                self.root, self.base, self.result, self.evidence(),
                task_contract=self.path_contract('**', 'app.py'), label='T1')

    def test_overlapping_task_path_contracts_are_independently_valid(self):
        first = self.path_contract('shared/**')
        second = self.path_contract('shared/**')
        paths = {'shared/component.py': 'M'}
        self.assertEqual(paths, validate_changed_paths(first, paths, 'T1'))
        self.assertEqual(paths, validate_changed_paths(second, paths, 'T2'))

    def test_real_table_and_fenced_test_output_are_valid(self):
        self.assertEqual({'app.py': 'A'}, validate_evidence(
            self.root, self.base, self.result, self.evidence(verification='```text\n3 passed\n```')))

    def test_example_table_does_not_count_as_delivery(self):
        for wrapper in ('```markdown\n{}\n```', '<!--\n{}\n-->'):
            with self.subTest(wrapper=wrapper):
                fake = wrapper.format('| `app.py` | A | Example, not a delivered row |')
                with self.assertRaises(ValueError):
                    validate_evidence(self.root, self.base, self.result, self.evidence(files=fake))

    def test_empty_comment_or_placeholder_verification_is_rejected(self):
        for value in ('<!-- evidence not written -->', 'pending', 'TBD', 'TODO', ''):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_evidence(self.root, self.base, self.result, self.evidence(verification=value))

    def test_domain_pending_word_is_not_a_placeholder(self):
        require_evidence_body('Asserted that the order remains pending after failure.', 'verification')

    def test_placeholder_file_note_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_evidence(self.root, self.base, self.result,
                              self.evidence(files='| `app.py` | A | TBD |'))

    def test_comment_only_close_evidence_is_rejected(self):
        init_project.initialize(self.root)
        change = new_change.create_change(self.root, 'close-evidence')
        fields, _ = metadata((change / 'index.md').read_text())
        body = ('# 变更\n\n## 目标\n核实既有行为。\n\n'
                '<!-- SDD:EVIDENCE:BEGIN -->\n## 验证结果\n<!-- empty -->\n'
                '## 最终结论\npass\n<!-- SDD:EVIDENCE:END -->\n')
        (change / fields['contract']).write_text(render_spec(
            {'integrated_revision': self.result, 'product': '无变化',
             'technology': '无变化', 'operations': '无变化'}, body))
        with self.assertRaisesRegex(ValueError, 'verification evidence'):
            check_change.check(self.root, change.name)


if __name__ == '__main__':
    unittest.main()
