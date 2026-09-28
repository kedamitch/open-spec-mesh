"""End-to-end local runtime regression tests in disposable Git repositories."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
for skill in ('sdd-init', 'sdd-change', 'sdd-do', 'sdd-close', 'sdd-release'):
    sys.path.insert(0, str(ROOT/skill/'scripts'))
import init_project, new_change, ensure_design, new_task, task_graph, workflow
import prepare_workspace, record_delivery, import_delivery, record_acceptance
import check_change, close_change, new_release, check_release, validate_docs, numbering
import run_validation, validation_receipt
from sdd_common import metadata, render_spec
from markdown_contract import BEGIN, END, split_contract


def contract(goal='支持预约取消'):
    body = f'''\n# 变更说明

> **目标**：{goal}

## 背景与问题

预约取消需要可验证地改变状态，同时保持现有认证语义。

## 目标与范围

### 目标

- {goal}。

### 本次包含

- 取消操作与状态一致性。

### 本次不做

- 不改变认证语义。

## Requirements

- **R01**：取消后状态必须一致。

## 行为与验收标准

### AC-01｜取消后状态一致

- **行为**：取消成功后状态一致。
- **验证**：执行回归测试并核对结果。

## 约束与待确认

### 已确定约束

- 不改变认证语义。

### 待确认

- 无。

## 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | booking |
| 应用 / 组件 | booking runtime |
| Domain | booking status |
| Database | 无 |
| API / Protocol | 无 |
| Operations | 无 |

{BEGIN}
## 验证结果

pending

## 最终结论

pending
{END}
'''
    return render_spec(
        dict(integrated_revision='pending', product='pending',
             technology='pending', operations='pending'),
        body)


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sdd-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)/'project'; self.root.mkdir()
        self.addCleanup(self.cleanup_worktrees)
        workflow.git(self.root, 'init', '-q')
        # Disposable repositories must never spawn automatic object maintenance
        # while TemporaryDirectory teardown is removing their .git directory.
        workflow.git(self.root, 'config', 'gc.auto', '0')
        workflow.git(self.root, 'config', 'maintenance.auto', 'false')
        workflow.git(self.root, 'config', 'user.name', 'Test')
        workflow.git(self.root, 'config', 'user.email', 'test@example.invalid')
        init_project.initialize(self.root)
        scripts = self.root/'scripts'
        scripts.mkdir()
        self.validation_script = scripts/'test_validate.py'
        self.validation_script.write_text("raise SystemExit(0)\n", encoding='utf-8')
        validation_doc = self.root/'docs/08-quality/Q01-validation.md'
        validation_doc.write_text(
            validation_doc.read_text(encoding='utf-8').replace(
                '待核实：填写项目内一个版本化 Python 验证入口，例如 `scripts/sdd_validate.py`。入口负责串行执行本项目全部 required checks，任一失败返回非零。',
                '`scripts/test_validate.py`',
            ),
            encoding='utf-8',
        )
        self.change = new_change.create_change(self.root, 'booking-cancel')
        self.change_doc.write_text(contract(), encoding='utf-8')
        self.commit()

    def cleanup_worktrees(self):
        """Retire registered test worktrees before TemporaryDirectory removes .git."""
        if not self.root.exists():
            return
        result = subprocess.run(
            ['git', '-C', str(self.root), 'worktree', 'list', '--porcelain'],
            text=True, capture_output=True,
        )
        if result.returncode:
            return
        root = self.root.resolve()
        locations = [
            Path(line[9:]).resolve()
            for line in result.stdout.splitlines()
            if line.startswith('worktree ')
        ]
        for location in locations:
            if location == root:
                continue
            subprocess.run(
                ['git', '-C', str(self.root), 'worktree', 'remove', '--force', str(location)],
                text=True, capture_output=True,
            )
        subprocess.run(
            ['git', '-C', str(self.root), 'worktree', 'prune'],
            text=True, capture_output=True,
        )

    @property
    def fields(self): return metadata((self.change/'index.md').read_text())[0]
    @property
    def change_doc(self): return self.change/self.fields['contract']
    @property
    def design_doc(self): return self.change/self.fields['design']

    def sync_design(self):
        graph = task_graph.load_graph(self.change/'C03-tasks/C03-task-graph.json')
        rows = []
        edges = []
        for item in graph['tasks']:
            deps = item['depends_on']
            dep_text = '无' if not deps else '、'.join(f'`{dep}`' for dep in deps)
            rows.append(
                f"| `{item['id']}` {Path(item['path']).name} | 实现 booking 局部能力 | "
                f"{dep_text} | `D001` 统一事务边界 | `AC-01` 取消后状态一致 |")
            for dep in deps:
                edges.append(f'    {dep.replace("-", "_")} --> {item["id"].replace("-", "_")}')
        if graph['tasks']:
            nodes = [
                f'    {item["id"].replace("-", "_")}[{item["id"]}]'
                for item in graph['tasks']
            ]
            mermaid = '\n'.join(nodes + edges)
        else:
            mermaid = '    Empty[尚未创建 Task]'

        self.design_doc.write_text(f'''# 公共设计

> **设计结论**：沿用现有事务边界，以最小 booking 变更满足取消状态一致性。

## Current 基线与变更范围

### 受影响 Current Truth

| Current 文档 / 模块 | Current | Delta | Target |
| --- | --- | --- | --- |
| booking | 支持基础预约 | 增加取消状态一致性 | 取消结果可验证 |

## 总体方案与主流程

### 总体方案

在现有 booking 边界内完成变更，不改变认证语义。

### 总业务流程 / 主时序

```mermaid
sequenceDiagram
    actor User
    participant Booking
    participant Store
    User->>Booking: cancel
    Booking->>Store: persist status
    Store-->>Booking: committed
    Booking-->>User: cancelled
```

## 产品变更

无额外产品模块变化，仅 booking 取消行为变化。

## 接口变更

无接口 Contract 变化。

## 领域模型与状态变更

booking 状态增加可验证取消结果；不改变其他状态规则。

## 数据与表结构变更

无表结构变化。

## 应用与组件变更

仅 booking runtime 局部实现变化。

## 关键决策

### D001｜统一事务边界

- **结论**：统一沿用现有事务边界。
- **原因**：避免为单一取消行为引入新一致性模型。
- **影响**：Worker 不得改变认证与事务边界。

## 公共设计与不变量

- **事务 / 一致性**：取消状态写入与结果一致。
- **幂等 / 并发**：不新增额外并发语义。
- **失败与恢复**：失败不伪造成功状态。
- **兼容**：保持现有认证语义。

## Task 关系与设计落点

```mermaid
flowchart LR
{mermaid}
```

| Task | 交付结果 | 前置任务 | 关联设计 | 验收 |
| --- | --- | --- | --- | --- |
{chr(10).join(rows) if rows else '| 无 | 尚未创建 Task | 无 | 无 | 无 |'}

## 实现自由度与停止条件

- **Worker 可自行决定**：局部代码组织。
- **不可改变**：认证、事务边界和 AC。
- **必须停止并 replan**：需要改变上述冻结边界时。

## 风险与未决问题

- **风险**：测试夹具只验证 SDD 生命周期。
- **未决问题**：无。
''', encoding='utf-8')

    def commit(self, root=None):
        root = root or self.root
        workflow.git(root, 'add', '.')
        workflow.git(root, 'commit', '--allow-empty', '-qm', 'test result')
        return workflow.revision(root, 'HEAD')

    def task(self, name='backend', deps=()):
        directory = new_task.create_task(self.root, self.change.name, name, deps)
        fields = metadata((directory/'index.md').read_text())[0]
        task_id = fields['id']
        dep_text = '无' if not deps else '\n'.join(f'- `{dep}`' for dep in deps)
        design_path = Path('../../C02-design.md')
        (directory/fields['contract']).write_text(f'''# Task `{task_id}`：详细设计

> **交付目标**：实现 booking 取消状态一致性。
>
> **公共设计**：[Design]({design_path})

## 范围与代码落点

### 要做

- 实现 booking 取消状态一致性。

### 不做

- 不改变认证语义。

### 输入 / 依赖

- 使用现有 booking 上下文。

### 代码结构 / 模块落点

| 目录 / 文件 / 类 | 计划变更 | 责任 |
| --- | --- | --- |
| booking | 修改 | 取消状态处理 |

## Task 实现流程

```mermaid
flowchart TD
    A[取消请求] --> B[校验 booking]
    B --> C[更新状态]
    C --> D[返回取消结果]
```

## 详细设计

### 核心逻辑

在现有事务边界内更新取消状态。

### Components

| Component / Object | Responsibility |
| --- | --- |
| Booking | 维护取消状态 |

### 接口变化

无接口变化。

### 领域模型 / 状态变化

booking 进入 cancelled 结果；其他状态语义不变。

### 数据与表结构变化

无表结构变化。

### 失败与兼容

- **失败处理**：失败不写成功状态。
- **边界场景**：重复取消保持现有语义。
- **兼容要求**：不改变认证语义。

### Tests

- **正常路径**：取消成功。
- **异常路径**：取消失败不写成功。
- **边界 / 回归**：既有 booking 回归。

## 依赖与验收

### 前置任务

{dep_text}

### 关联设计

- `D001`：统一事务边界。

### 验收标准

- `AC-01`：取消后状态一致。

### 验证要求

- 运行当前 Task 的定向测试并核对 diff。
- 必要时运行局部 build/static check；项目全量验证由 Main 集成后统一执行。

## 实现自由度

- **可以自行决定**：局部函数拆分。
- **不可改变**：认证、事务边界和 AC。

## 交付要求

### Expected Output

- **预计文件**：booking 相关实现与测试。
- **交付结果**：可验证的取消状态一致性。

### Delivery

- 提交 revision、逐文件影响、验证、自审和剩余问题。
''', encoding='utf-8')
        self.sync_design()
        return task_id

    def ctx(self, task, root=None): return workflow.context(root or self.root, self.change.name, task)
    def info(self, task, root=None): return self.ctx(task, root)[4]
    def report(self, task, root=None):
        ctx = self.ctx(task, root)
        return ctx[5]/ctx[6]['report']

    def approve(self, task): workflow.transition(self.root, self.change.name, task, 'approve')
    def start(self, task):
        self.approve(task)
        prepare_workspace.prepare(self.root, self.change.name, task)

    def deliver(self, task, root=None, evidence='validated'):
        from delivery_evidence import changed_files
        root = root or self.root
        sha = self.commit(root)
        info = self.info(task, root)
        table = '| 文件 | 操作 | 行为影响 |\n| --- | --- | --- |\n'
        for path, status in changed_files(root, info['baseline'], sha).items():
            table += f'| `{path}` | {status} | {evidence} |\n'
        report = (
            '## 文件改动\n\n> **交付结果**：完成 booking 测试夹具实现。\n\n'
            + table
            + '\n## 验证结果\n\n- **结论**：通过\n\n'
            + '| AC / 场景 | 检查 | 结果 | 证据 |\n'
            + '| --- | --- | --- | --- |\n'
            + f'| `AC-01` | booking 定向测试 | 通过 | {evidence} |\n'
            + '\n## 自审结论\n\n- **已修复问题**：无\n- **契约偏差**：无\n'
            + '\n## 剩余问题\n\n- **未验证项**：无\n- **剩余风险**：无\n'
            + '\n## 快照影响\n\n- **范围**：无\n- **说明**：测试夹具，无业务快照变化。\n'
        )
        record_delivery.deliver(root, self.change.name, task, sha, report, info['attempt'])
        return sha

    def accept(self, task):
        self.deliver(task)
        workflow.transition(self.root, self.change.name, task, 'submit')
        record_acceptance.accept(self.root, self.change.name, task, 'accept', 'verified')

    def verdict(self):
        fields, body = metadata(self.change_doc.read_text())
        fields.update(integrated_revision=workflow.revision(self.root, 'HEAD'), product='no behavior change beyond verified AC',
                      technology='no additional architecture changes', operations='no runtime deployment change')
        body = body.replace('## 验证结果\n\npending', '## 验证结果\n\nAC-01: regression passed')
        body = body.replace('## 最终结论\n\npending', '## 最终结论\n\npass')
        self.change_doc.write_text(render_spec(fields, body))
        run_validation.run_validation(self.root, self.change.name, fields['integrated_revision'])

    def worktree(self, task):
        self.approve(task)
        self.commit()
        location = Path(self.tmp.name)/task
        prepare_workspace.prepare(self.root, self.change.name, task, worktree=location)
        return location

    def test_canonical_change_artifacts_and_mandatory_design(self):
        self.assertEqual(
            {'index.md', 'C01-change.md', 'C02-design.md', 'C03-tasks'},
            {p.name for p in self.change.iterdir()})
        self.assertEqual('C01-change.md', self.fields['contract'])
        self.assertEqual('C02-design.md', self.fields['design'])
        self.assertEqual('C03-tasks', self.fields['tasks'])
        self.assertEqual('C03-tasks/C03-task-graph.json', self.fields['graph'])
        first = ensure_design.ensure(self.root, self.change.name)
        self.assertEqual(first, ensure_design.ensure(self.root, self.change.name))
        task = self.task(); ctx = self.ctx(task)
        self.assertEqual({'id', 'contract', 'report'}, set(ctx[6]))
        self.assertTrue(ctx[6]['contract'].endswith('-task.md'))
        self.assertTrue(ctx[6]['report'].endswith('-delivery.md'))

    def test_new_task_graph_is_topology_only_without_acceptance_field(self):
        task = self.task()
        info = self.info(task)
        self.assertNotIn('acceptance', info)
        self.assertEqual({'id', 'path', 'depends_on', 'state', 'history'}, set(info))

    def test_unfinished_plan_cannot_approve(self):
        task = self.task()
        self.change_doc.write_text(self.change_doc.read_text().replace('支持预约取消', '待补充。'))
        with self.assertRaises(ValueError): self.approve(task)

    def test_contract_drift_prevents_prepare(self):
        task = self.task(); self.approve(task)
        self.change_doc.write_text(self.change_doc.read_text().replace('支持预约取消', '支持其他行为'))
        with self.assertRaises(ValueError): prepare_workspace.prepare(self.root, self.change.name, task)

    def test_close_evidence_keeps_digest(self):
        task = self.task(); self.approve(task); before = self.info(task)['contract_digest']
        self.verdict(); c = self.ctx(task)
        self.assertEqual(before, workflow.contract_digest(self.root, c[0], c[1], c[5], c[6]))

    def test_dependency_requires_acceptance_and_real_baseline(self):
        first = self.task(); second = self.task('frontend', [first]); self.start(first)
        old = workflow.revision(self.root, 'HEAD')
        self.deliver(first); workflow.transition(self.root, self.change.name, first, 'submit'); self.approve(second)
        with self.assertRaises(ValueError): prepare_workspace.prepare(self.root, self.change.name, second)
        record_acceptance.accept(self.root, self.change.name, first, 'accept', 'verified')
        with self.assertRaises(ValueError): prepare_workspace.prepare(self.root, self.change.name, second, base=old)
        prepare_workspace.prepare(self.root, self.change.name, second)

    def test_rework_accepted_invalidates_descendants_only(self):
        first = self.task(); second = self.task('frontend', [first]); other = self.task('independent')
        for task in (first, second, other): self.start(task); self.accept(task)
        old = self.info(first)['result_revision']
        workflow.transition(self.root, self.change.name, first, 'rework', 'fix an implementation defect')
        self.assertEqual('planned', self.info(first)['state'])
        self.assertEqual('planned', self.info(second)['state'])
        self.assertEqual('accepted', self.info(other)['state'])
        self.assertNotIn('result_revision', self.info(first))
        self.assertEqual(old, self.info(first)['history'][-1]['previous']['result_revision'])
        for task in (first, second): self.start(task); self.accept(task)
        self.verdict(); self.assertTrue(check_change.check(self.root, self.change.name))

    def test_shared_design_change_invalidates_all_frozen_tasks(self):
        first = self.task(); other = self.task('independent')
        for task in (first, other): self.start(task); self.accept(task)
        design = ensure_design.ensure(self.root, self.change.name)
        design.write_text(design.read_text().replace(
            '统一沿用现有事务边界', '只在事务成功后确认'), encoding='utf-8')
        workflow.transition(self.root, self.change.name, first, 'replan', 'shared design corrected', user_confirmed=True)
        for task in (first, other): self.assertEqual('planned', self.info(task)['state'])

    def test_running_worker_requires_explicit_quiescence(self):
        task = self.task(); self.start(task)
        graph = self.ctx(task)[2]; before = graph.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Stop affected workers'):
            workflow.transition(self.root, self.change.name, task, 'rework', 'feedback')
        self.assertEqual(before, graph.read_bytes())
        workflow.transition(self.root, self.change.name, task, 'rework', 'feedback', workers_stopped=True)
        self.assertEqual('planned', self.info(task)['state'])

    def test_stale_attempt_rejected_even_with_identical_contract(self):
        task = self.task(); self.start(task); self.accept(task)
        old = self.report(task).read_text()
        workflow.transition(self.root, self.change.name, task, 'rework', 'retest')
        self.start(task)
        self.assertEqual(2, self.info(task)['attempt'])
        self.report(task).write_text(old)
        with self.assertRaisesRegex(ValueError, 'Stale delivery'):
            workflow.transition(self.root, self.change.name, task, 'submit')

    def test_delivery_replaces_report_instead_of_appending(self):
        task = self.task(); self.start(task)
        self.deliver(task, evidence='old evidence')
        self.deliver(task, evidence='new evidence')
        report = self.report(task).read_text()
        self.assertNotIn('old evidence', report)
        self.assertEqual(1, report.count('# 任务交付报告'))
        self.assertNotIn('待交付', report)

    def test_worker_delivery_ignores_conflicting_legacy_path_contract(self):
        task = self.task()
        ctx = self.ctx(task)
        contract_path = ctx[5] / ctx[6]['contract']
        contract = contract_path.read_text()
        insertion = ('### Path Contract\n\n| 规则 | 路径 |\n| --- | --- |\n'
                     '| allow | `allowed/**` |\n| deny | `outside.txt` |\n\n')
        contract_path.write_text(contract.replace('### 代码结构 / 模块落点', insertion + '### 代码结构 / 模块落点'), encoding='utf-8')
        location = self.worktree(task)
        (location/'outside.txt').write_text('out of scope')
        self.deliver(task, location)
        self.assertEqual('running', self.info(task)['state'])
        self.assertIn('outside.txt', self.report(task, location).read_text())

    def test_import_then_accept_worktree_delivery(self):
        task = self.task(); location = self.worktree(task)
        (location/'implementation.txt').write_text('result')
        self.deliver(task, location)
        self.assertEqual('running', self.info(task)['state'])
        self.assertEqual('submitted', import_delivery.import_delivery(self.root, self.change.name, task, location))
        record_acceptance.accept(self.root, self.change.name, task, 'accept', 'verified worktree')
        self.assertEqual('accepted', self.info(task)['state'])
        self.assertEqual('running', self.info(task, location)['state'])  # Worker never writes authoritative state.

    def test_import_rejects_wrong_workspace(self):
        task = self.task(); self.worktree(task)
        with self.assertRaises(ValueError): import_delivery.import_delivery(self.root, self.change.name, task, self.root)

    def test_import_rejects_worker_contract_edit(self):
        task = self.task(); location = self.worktree(task); self.deliver(task, location)
        ctx = self.ctx(task, location)
        (ctx[5]/ctx[6]['contract']).write_text('# 不同契约')
        with self.assertRaisesRegex(ValueError, 'stale or modified'):
            import_delivery.import_delivery(self.root, self.change.name, task, location)

    def test_import_is_transactional(self):
        task = self.task(); location = self.worktree(task); self.deliver(task, location)
        old_report = self.report(task).read_bytes(); old_graph = self.ctx(task)[2].read_bytes()
        with patch.object(import_delivery, 'transition', side_effect=ValueError('injected')):
            with self.assertRaises(ValueError): import_delivery.import_delivery(self.root, self.change.name, task, location)
        self.assertEqual(old_report, self.report(task).read_bytes())
        self.assertEqual(old_graph, self.ctx(task)[2].read_bytes())

    def test_reuse_syncs_contract_and_preserves_code_and_report(self):
        task = self.task(); location = self.worktree(task)
        (location/'implementation.txt').write_text('preserve me')
        sha = self.deliver(task, location)
        import_delivery.import_delivery(self.root, self.change.name, task, location)
        record_acceptance.accept(self.root, self.change.name, task, 'accept', 'verified')
        old_report = self.report(task, location).read_bytes()
        self.change_doc.write_text(self.change_doc.read_text().replace('支持预约取消', '支持预约撤销'))
        workflow.transition(self.root, self.change.name, task, 'replan', 'new wording', user_confirmed=True)
        self.approve(task)
        prepare_workspace.prepare(self.root, self.change.name, task, base=sha, reuse=True)
        self.assertEqual('preserve me', (location/'implementation.txt').read_text())
        self.assertEqual(old_report, self.report(task, location).read_bytes())
        self.assertEqual(self.change_doc.read_text(), (location/self.change_doc.relative_to(self.root)).read_text())
        with self.assertRaisesRegex(ValueError, 'Stale delivery|different contract'):
            import_delivery.import_delivery(self.root, self.change.name, task, location)
        self.deliver(task, location)
        import_delivery.import_delivery(self.root, self.change.name, task, location)

    def test_reuse_does_not_discard_uncommitted_implementation(self):
        task = self.task(); location = self.worktree(task)
        workflow.transition(self.root, self.change.name, task, 'rework', 'retry', workers_stopped=True)
        self.approve(task); (location/'uncommitted.py').write_text('important work')
        with self.assertRaisesRegex(ValueError, 'implementation edits'):
            prepare_workspace.prepare(self.root, self.change.name, task, base=workflow.revision(location, 'HEAD'), reuse=True)
        self.assertEqual('important work', (location/'uncommitted.py').read_text())
        self.assertEqual('planned', self.info(task)['state'])

    def test_main_workspace_rejects_uncommitted_implementation(self):
        task = self.task()
        self.approve(task)
        dirty = self.root/'uncommitted.py'
        dirty.write_text('important work')
        with self.assertRaisesRegex(ValueError, 'implementation edits'):
            prepare_workspace.prepare(self.root, self.change.name, task)
        self.assertEqual('important work', dirty.read_text())
        self.assertEqual('planned', self.info(task)['state'])
        self.assertNotIn('attempt', self.info(task))

    def test_failed_sync_restores_existing_workspace_and_main_graph(self):
        task = self.task(); location = self.worktree(task)
        workflow.transition(self.root, self.change.name, task, 'rework', 'retry', workers_stopped=True)
        self.approve(task)
        old = (location/self.change_doc.relative_to(self.root)).read_bytes()
        graph = self.ctx(task)[2].read_bytes()
        original = prepare_workspace.save_graph
        def failure(path, data):
            if path == self.ctx(task)[2]: raise OSError('injected Main graph save failure')
            return original(path, data)
        with patch.object(prepare_workspace, 'save_graph', side_effect=failure):
            with self.assertRaises(OSError):
                prepare_workspace.prepare(self.root, self.change.name, task, base=workflow.revision(location, 'HEAD'), reuse=True)
        self.assertEqual(graph, self.ctx(task)[2].read_bytes())
        self.assertEqual(old, (location/self.change_doc.relative_to(self.root)).read_bytes())

    def test_close_and_release(self):
        task = self.task(); self.start(task); self.accept(task); self.verdict()
        completed = close_change.close_change(self.root, self.change.name)
        self.assertEqual('completed', metadata((completed/'index.md').read_text())[0]['status'])
        release = new_release.create_release(self.root, '1.0.0', 'release-one', [self.change.name])
        fields = metadata((release/'index.md').read_text())[0]
        self.assertTrue(fields['note'].endswith('-release-notes.md'))
        self.assertTrue(fields['checklist'].endswith('-release-checklist.md'))
        note = (release/fields['note']).read_text().replace(
            '## 最终结论\n\npending', '## 最终结论\n\npass')
        (release/fields['note']).write_text(note)
        checklist = (release/fields['checklist']).read_text().replace('[ ]', '[x]')
        (release/fields['checklist']).write_text(checklist)
        self.assertEqual('1.0.0', check_release.check(self.root, release.relative_to(self.root)))

    def test_changed_report_rejected_at_acceptance_and_close(self):
        task = self.task(); self.start(task); self.deliver(task)
        workflow.transition(self.root, self.change.name, task, 'submit')
        old = self.report(task).read_text(); self.report(task).write_text(old+'tampered')
        with self.assertRaises(ValueError): record_acceptance.accept(self.root, self.change.name, task, 'accept', 'verified')
        self.report(task).write_text(old)
        record_acceptance.accept(self.root, self.change.name, task, 'accept', 'verified')
        self.verdict(); self.report(task).write_text(old+'tampered')
        with self.assertRaises(ValueError): check_change.check(self.root, self.change.name)

    def test_validation_entrypoint_allows_review_prose_after_path(self):
        doc = self.root/'docs/08-quality/Q01-validation.md'
        doc.write_text(doc.read_text() + '\n')
        text = doc.read_text()
        text = text.replace(
            '`scripts/test_validate.py`\n\n## Required Checks',
            '`scripts/test_validate.py`\n\n这是给人看的解释，不属于机器路径。\n\n## Required Checks',
        )
        doc.write_text(text)
        self.assertEqual(
            'scripts/test_validate.py',
            validation_receipt.validation_entrypoint(self.root)['path'],
        )

    def test_close_requires_machine_validation_receipt(self):
        task = self.task(); self.start(task); self.accept(task); self.verdict()
        validation_receipt.receipt_path(self.root, self.change.name).unlink()
        with self.assertRaisesRegex(ValueError, 'Machine validation receipt required'):
            check_change.check(self.root, self.change.name)

    def test_validation_receipt_is_invalidated_when_entrypoint_changes(self):
        task = self.task(); self.start(task); self.accept(task); self.verdict()
        self.validation_script.write_text('print("changed")\n')
        with self.assertRaisesRegex(ValueError, 'receipt mismatch: entrypoint'):
            check_change.check(self.root, self.change.name)

    def test_validation_entrypoint_must_be_committed(self):
        task = self.task(); self.start(task); self.accept(task)
        self.validation_script.write_text('print("dirty entrypoint")\n')
        with self.assertRaisesRegex(ValueError, 'tracked and committed'):
            self.verdict()

    def test_validation_command_cannot_mutate_change_artifacts(self):
        task = self.task(); self.start(task); self.accept(task)
        self.validation_script.write_text(
            "from pathlib import Path\n"
            "p = next(Path('docs/05-changes/C01-进行中').glob('CHG-*')) / 'index.md'\n"
            "p.write_text(p.read_text() + '\\n')\n"
        )
        self.commit()
        with self.assertRaisesRegex(ValueError, 'changed the validated revision or project artifacts'):
            self.verdict()
        receipt = validation_receipt.load_receipt(self.root, self.change.name)
        self.assertFalse(receipt['passed'])

    def test_failed_validation_cannot_create_a_passing_receipt(self):
        task = self.task(); self.start(task); self.accept(task)
        self.validation_script.write_text('raise SystemExit(7)\n')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'exit code 7'):
            self.verdict()
        receipt = validation_receipt.load_receipt(self.root, self.change.name)
        self.assertFalse(receipt['passed'])
        self.assertEqual(7, receipt['exit_code'])

    def test_close_rejects_implementation_changes_after_validation(self):
        task = self.task(); self.start(task); self.accept(task); self.verdict()
        late = self.root/'late-change.py'
        late.write_text('changed after validation\n')
        with self.assertRaisesRegex(ValueError, 'Unvalidated project changes'):
            check_change.check(self.root, self.change.name)

    def test_close_rejects_current_truth_changes_after_validation(self):
        task = self.task(); self.start(task); self.accept(task); self.verdict()
        current = self.root/'docs/02-product/P01-product-overview.md'
        current.write_text(current.read_text() + '\npost-validation drift\n')
        with self.assertRaisesRegex(ValueError, 'Unvalidated project changes'):
            check_change.check(self.root, self.change.name)

    def test_close_requires_actual_evidence(self):
        task = self.task(); self.start(task); self.accept(task)
        self.verdict(); self.assertTrue(check_change.check(self.root, self.change.name))
        self.change_doc.write_text(self.change_doc.read_text().replace('AC-01: regression passed', 'pending'))
        with self.assertRaisesRegex(ValueError, 'verification evidence'):
            check_change.check(self.root, self.change.name)

    def test_structured_init_idempotent_and_preserves_user_data(self):
        doc = self.root/'docs/02-product/P01-product-overview.md'; doc.write_text('# My facts\n')
        init_project.initialize(self.root)
        self.assertEqual('# My facts\n', doc.read_text())
        for file in ('T01-architecture-overview.md', 'T02-api.md', 'T03-database.md', 'T04-domain-model.md', 'T05-diagrams/index.md'):
            self.assertTrue((self.root/'docs/03-architecture'/file).exists())
        self.assertEqual([], validate_docs.validate(self.root))

    def test_docs_allow_only_mapped_runtime_json(self):
        task = self.task()
        self.assertEqual([], validate_docs.validate(self.root))
        fake = self.root/'docs/03-architecture/T06-task-graph-fake.json'; fake.write_text('{}')
        self.assertTrue(any('Non-Markdown' in e for e in validate_docs.validate(self.root)))
        fake.unlink()
        doc = self.root/'docs/03-architecture/T06-diagram.pdf'; doc.write_text('not a PDF')
        self.assertTrue(any('Non-Markdown' in e for e in validate_docs.validate(self.root)))

    def test_links_in_code_examples_ignored_but_real_links_checked(self):
        doc = self.root/'docs/03-architecture/T06-example.md'
        doc.write_text('~~~markdown\n[example](missing.md)\n~~~\n')
        self.assertEqual([], validate_docs.validate(self.root))
        doc.write_text('[real](missing.md)\n')
        self.assertTrue(any('Broken link' in e for e in validate_docs.validate(self.root)))


class MarkdownTest(unittest.TestCase):
    def test_examples_cannot_truncate_frozen_input(self):
        for fence in ('```', '~~~~'):
            body = contract().replace('## 约束', f'{fence}markdown\n## 验证结果\n{BEGIN}\n{END}\n{fence}\n\n## 约束')
            self.assertNotEqual(split_contract(body)[0], split_contract(body.replace('不改变认证语义', '认证语义改变'))[0])

    def test_reject_ambiguous_or_incomplete_markers(self):
        for bad in (contract().replace(END, ''), contract().replace(BEGIN, BEGIN+'\n'+BEGIN),
                    contract()+'\n## 后置业务要求\n重要', contract().replace(BEGIN, END)):
            with self.assertRaises(ValueError): split_contract(bad)

    def test_unknown_metadata_is_frozen(self):
        text = contract().replace('product: pending', 'product: pending\npermission: staff')
        self.assertNotEqual(split_contract(text)[0], split_contract(text.replace('permission: staff', 'permission: admin'))[0])
        self.assertEqual(split_contract(contract())[0], split_contract(contract().replace('product: pending', 'product: updated'))[0])

    def test_legacy_heading_evidence_format_is_rejected(self):
        old = '# 需求\n## Verification\n测试通过\n## Final Decision\npass\n'
        with self.assertRaises(ValueError):
            split_contract(old)

    def test_final_decision_is_unique_visible_and_exact(self):
        check_change.require_pass('~~~markdown\n## 最终结论\nfail\n~~~\n## 最终结论\npass\n')
        for text in ('## 最终结论\npass\nfail', '## 最终结论\npass\n## Final Decision\npass', '~~~\n## 最终结论\npass\n~~~'):
            with self.assertRaises(ValueError): check_change.require_pass(text)


class GraphTest(unittest.TestCase):
    def task(self, key='T1', deps=(), state='planned'):
        value = {'id':key, 'depends_on':list(deps), 'state':state}
        if state in ('submitted', 'accepted'): value['result_revision']='a'*40
        return value

    def test_dag_and_shape_rules(self):
        first = self.task(state='accepted'); second = self.task('T2', ['T1'])
        self.assertEqual(['T2'], task_graph.validate_graph({'tasks':[first,second]})['ready'])
        for bad in (None, {}, {'tasks':[]}, {'tasks':[first,first]}, {'tasks':[dict(first,unexpected=True)]},
                    {'tasks':[self.task('T1',['T2']),self.task('T2',['T1'])]}, {'tasks':[dict(first,attempt=0)]}):
            with self.assertRaises(ValueError): task_graph.validate_graph(bad)

    def test_legacy_acceptance_field_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'graph.json'
            path.write_text(json.dumps({'tasks': [{
                'id': 'T1', 'depends_on': [], 'state': 'planned',
                'acceptance': ['legacy-task.md']
            }]}))
            graph = task_graph.load_graph(path)
            self.assertIn('acceptance', graph['tasks'][0])
            with self.assertRaises(ValueError):
                task_graph.validate_graph(graph)

    def test_large_dag_no_recursion_limit(self):
        tasks = [self.task(f'T{i}', [f'T{i-1}'] if i else [], 'accepted') for i in range(1000)]
        self.assertEqual([], task_graph.validate_graph({'tasks':tasks})['ready'])


if __name__ == '__main__': unittest.main()
