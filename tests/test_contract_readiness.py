"""Canonical SDD readiness gates: one human-readable C01/C02/C03 format, no legacy compatibility."""
from pathlib import Path
import re
import unittest

import test_sdd as fixture
from test_sdd import workflow, prepare_workspace
from sdd_common import metadata


class ContractReadinessTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.LifecycleTest()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)

    def task_contract(self, task):
        *_, directory, fields = self.f.ctx(task)
        return directory / fields['contract']

    def rejection_preserves_graph(self, task, regex=None):
        graph = self.f.ctx(task)[2]
        before = graph.read_bytes()
        cm = self.assertRaisesRegex(ValueError, regex) if regex else self.assertRaises(ValueError)
        with cm:
            self.f.approve(task)
        self.assertEqual(before, graph.read_bytes())

    def test_canonical_change_design_task_is_dispatchable(self):
        task = self.f.task()
        self.f.approve(task)
        self.assertTrue(self.f.info(task)['contract_digest'])

    def test_change_requires_ac_subsection(self):
        task = self.f.task()
        self.f.change_doc.write_text(
            self.f.change_doc.read_text().replace(
                '### AC-01｜取消后状态一致',
                '### 取消后状态一致'),
            encoding='utf-8')
        self.rejection_preserves_graph(task, 'AC-xx subsection')

    def test_change_placeholder_is_rejected(self):
        task = self.f.task()
        self.f.change_doc.write_text(
            self.f.change_doc.read_text().replace(
                '> **目标**：支持预约取消',
                '> **目标**：待补充。'),
            encoding='utf-8')
        self.rejection_preserves_graph(task)

    def test_design_placeholder_is_rejected(self):
        task = self.f.task()
        self.f.design_doc.write_text(
            self.f.design_doc.read_text().replace(
                '> **设计结论**：沿用现有事务边界',
                '> **设计结论**：待补充。'),
            encoding='utf-8')
        self.rejection_preserves_graph(task)

    def test_task_placeholder_is_rejected(self):
        task = self.f.task()
        path = self.task_contract(task)
        path.write_text(
            path.read_text().replace(
                '> **交付目标**：实现 booking 取消状态一致性。',
                '> **交付目标**：待补充。'),
            encoding='utf-8')
        self.rejection_preserves_graph(task)

    def test_explicit_no_change_keeps_fixed_dimensions_dispatchable(self):
        task = self.f.task()
        design = self.f.design_doc.read_text()
        for heading in ('产品变更', '接口变更', '领域模型与状态变更', '数据与表结构变更', '应用与组件变更'):
            design = re.sub(
                rf'(^## {re.escape(heading)}\n).*?(?=^## |\Z)',
                f'## {heading}\n\n无变化。\n\n',
                design, flags=re.M | re.S,
            )
        self.f.design_doc.write_text(design, encoding='utf-8')

        path = self.task_contract(task)
        text = path.read_text()
        for heading in ('Components', '接口变化', '领域模型 / 状态变化', '数据与表结构变化'):
            text = re.sub(
                rf'(^### {re.escape(heading)}\n).*?(?=^### |^## |\Z)',
                f'### {heading}\n\n无变化。\n\n',
                text, flags=re.M | re.S,
            )
        path.write_text(text, encoding='utf-8')
        self.f.approve(task)
        self.assertTrue(self.f.info(task)['contract_digest'])

    def test_fixed_no_change_dimensions_cannot_be_omitted(self):
        task = self.f.task()
        self.f.design_doc.write_text(
            re.sub(r'^## 数据与表结构变更\n.*?(?=^## |\Z)', '',
                   self.f.design_doc.read_text(), flags=re.M | re.S),
            encoding='utf-8',
        )
        self.rejection_preserves_graph(task, 'missing section: 数据与表结构变更')

    def test_task_without_path_contract_can_be_frozen(self):
        task = self.f.task()
        self.f.approve(task)
        self.assertTrue(self.f.info(task)['contract_digest'])

    def test_design_requires_main_flow_mermaid(self):
        task = self.f.task()
        self.f.design_doc.write_text(
            self.f.design_doc.read_text().replace('sequenceDiagram', 'not-a-diagram'),
            encoding='utf-8')
        self.rejection_preserves_graph(task, 'Mermaid must contain')

    def test_task_requires_local_flow_mermaid(self):
        task = self.f.task()
        path = self.task_contract(task)
        path.write_text(path.read_text().replace('flowchart TD', 'not-a-diagram'), encoding='utf-8')
        self.rejection_preserves_graph(task, 'Mermaid must contain')

    def test_all_task_designs_must_be_complete_before_first_dispatch(self):
        first = self.f.task('backend')
        second = self.f.task('frontend', [first])
        path = self.task_contract(second)
        path.write_text(
            path.read_text().replace(
                '> **交付目标**：实现 booking 取消状态一致性。',
                '> **交付目标**：待补充。'),
            encoding='utf-8')
        self.rejection_preserves_graph(first)

    def test_design_dependencies_must_match_graph(self):
        first = self.f.task('backend')
        second = self.f.task('frontend', [first])
        design = self.f.design_doc.read_text()
        needle = f'| `{second}` C03-02-frontend | 实现 booking 局部能力 | `{first}` |'
        # Be robust to the actual generated directory label.
        line = next(line for line in design.splitlines() if line.startswith(f'| `{second}` '))
        self.f.design_doc.write_text(
            design.replace(line, line.replace(f'`{first}`', '无', 1)),
            encoding='utf-8')
        self.rejection_preserves_graph(first, 'Design depends_on mismatch')

    def test_task_dependencies_must_match_graph(self):
        first = self.f.task('backend')
        second = self.f.task('frontend', [first])
        path = self.task_contract(second)
        path.write_text(
            path.read_text().replace(
                f'- `{first}`',
                '- 无。'),
            encoding='utf-8')
        self.rejection_preserves_graph(first, 'depends_on mismatch')

    def test_task_rejects_unknown_ac(self):
        task = self.f.task()
        path = self.task_contract(task)
        path.write_text(path.read_text().replace('`AC-01`', '`AC-99`'), encoding='utf-8')
        self.rejection_preserves_graph(task, 'unknown Change AC')

    def test_task_rejects_unknown_design_decision(self):
        task = self.f.task()
        path = self.task_contract(task)
        path.write_text(path.read_text().replace('`D001`', '`D999`'), encoding='utf-8')
        self.rejection_preserves_graph(task, 'unknown Design')

    def test_evidence_and_close_metadata_do_not_change_readiness(self):
        task = self.f.task()
        text = self.f.change_doc.read_text()
        text = text.replace('integrated_revision: pending', 'integrated_revision: pending\nstatus_note: pending')
        self.f.change_doc.write_text(text, encoding='utf-8')
        self.f.approve(task)
        self.assertTrue(self.f.info(task)['contract_digest'])

    def test_prepare_rechecks_malformed_frozen_contract(self):
        task = self.f.task()
        self.f.approve(task)
        path = self.task_contract(task)
        path.write_text(
            path.read_text().replace(
                '> **交付目标**：实现 booking 取消状态一致性。',
                '> **交付目标**：待补充。'),
            encoding='utf-8')
        graph = self.f.ctx(task)[2]
        before = graph.read_bytes()
        worker = Path(self.f.tmp.name) / 'should-not-exist'
        with self.assertRaises(ValueError):
            prepare_workspace.prepare(
                self.f.root, self.f.change.name, task, worktree=worker)
        self.assertFalse(worker.exists())
        self.assertEqual(before, graph.read_bytes())

    def test_local_task_edit_only_changes_own_scoped_digest(self):
        first = self.f.task('backend')
        other = self.f.task('independent')
        for task in (first, other):
            self.f.approve(task)

        first_before = self.f.info(first)['contract_digest']
        other_before = self.f.info(other)['contract_digest']
        path = self.task_contract(first)
        path.write_text(
            path.read_text().replace(
                '在现有事务边界内更新取消状态。',
                '在现有事务边界内更新取消状态并映射局部错误。'),
            encoding='utf-8')

        first_ctx = self.f.ctx(first)
        other_ctx = self.f.ctx(other)
        self.assertNotEqual(
            first_before,
            workflow.contract_digest(
                self.f.root, first_ctx[0], first_ctx[1], first_ctx[5], first_ctx[6]))
        self.assertEqual(
            other_before,
            workflow.contract_digest(
                self.f.root, other_ctx[0], other_ctx[1], other_ctx[5], other_ctx[6]))

    def test_shared_design_edit_changes_all_sibling_digests(self):
        first = self.f.task('backend')
        other = self.f.task('independent')
        for task in (first, other):
            self.f.approve(task)
        before = {task: self.f.info(task)['contract_digest'] for task in (first, other)}

        self.f.design_doc.write_text(
            self.f.design_doc.read_text().replace(
                '- **失败与恢复**：失败不伪造成功状态。',
                '- **失败与恢复**：失败不伪造成功状态，并记录失败原因。'),
            encoding='utf-8')

        for task in (first, other):
            ctx = self.f.ctx(task)
            self.assertNotEqual(
                before[task],
                workflow.contract_digest(
                    self.f.root, ctx[0], ctx[1], ctx[5], ctx[6]))

    def test_unrelated_change_ac_edit_does_not_change_scoped_digest(self):
        task = self.f.task()
        text = self.f.change_doc.read_text()
        extra = '''\n### AC-02｜查询保持稳定\n\n- **行为**：查询结果保持稳定。\n- **验证**：运行查询回归。\n'''
        self.f.change_doc.write_text(
            text.replace('\n## 约束与待确认\n', extra + '\n## 约束与待确认\n'),
            encoding='utf-8')
        # Design maps the Task only to AC-01.
        self.f.approve(task)
        before = self.f.info(task)['contract_digest']
        self.f.change_doc.write_text(
            self.f.change_doc.read_text().replace(
                '查询结果保持稳定。',
                '查询结果保持稳定且保留排序。'),
            encoding='utf-8')
        ctx = self.f.ctx(task)
        self.assertEqual(
            before,
            workflow.contract_digest(
                self.f.root, ctx[0], ctx[1], ctx[5], ctx[6]))

    def test_unrelated_design_decision_edit_does_not_change_scoped_digest(self):
        task = self.f.task()
        text = self.f.design_doc.read_text()
        extra = '''\n### D002｜查询读取路径\n\n- **结论**：查询沿用原读取路径。\n- **原因**：不影响取消。\n- **影响**：无。\n'''
        self.f.design_doc.write_text(
            text.replace('\n## 公共设计与不变量\n', extra + '\n## 公共设计与不变量\n'),
            encoding='utf-8')
        self.f.approve(task)
        before = self.f.info(task)['contract_digest']
        self.f.design_doc.write_text(
            self.f.design_doc.read_text().replace(
                '查询沿用原读取路径。',
                '查询沿用原读取路径并保持缓存策略。'),
            encoding='utf-8')
        ctx = self.f.ctx(task)
        self.assertEqual(
            before,
            workflow.contract_digest(
                self.f.root, ctx[0], ctx[1], ctx[5], ctx[6]))

    def test_legacy_compact_change_format_is_rejected(self):
        task = self.f.task()
        fields, _ = metadata(self.f.change_doc.read_text())
        old = fixture.render_spec(
            fields,
            '# 变更\n\nAC-01：取消后状态一致。\n\n'
            + fixture.BEGIN
            + '\n## 验证结果\npending\n\n## 最终结论\npending\n'
            + fixture.END + '\n')
        self.f.change_doc.write_text(old, encoding='utf-8')
        self.rejection_preserves_graph(task)

    def test_legacy_minimal_task_format_is_rejected(self):
        task = self.f.task()
        self.task_contract(task).write_text(
            '# 任务契约\n\n实现 AC-01；不改认证。\n',
            encoding='utf-8')
        self.rejection_preserves_graph(task)


if __name__ == '__main__':
    unittest.main()
