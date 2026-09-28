"""Keep Quick / SDD ownership and Main-local routing stable."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


def text(path):
    return (ROOT / path).read_text(encoding='utf-8')


def subsection(document, title):
    match = re.search(r'^### ' + re.escape(title) + r'\n(.*?)(?=^#{1,3} |\Z)', document, re.M | re.S)
    if not match:
        raise AssertionError('Missing mode: ' + title)
    return match[1]


class ProcessModeTests(unittest.TestCase):
    def test_primary_guidance_has_only_quick_and_sdd(self):
        rules = text('AGENTS.md')
        self.assertTrue(rules.startswith('# 工作约定\n'))
        self.assertLessEqual(len(rules), 3200)
        self.assertNotIn('Simple Change', rules)
        self.assertNotIn('Complex Change', rules)
        subsection(rules, 'Quick')
        subsection(rules, 'SDD')

    def test_quick_is_main_owned_and_investigation_is_optional(self):
        quick = subsection(text('AGENTS.md'), 'Quick')
        self.assertIn('直接实现、测试、自审', quick)
        self.assertIn('可按需委派只读调查', quick)
        self.assertIn('不建 Change / Task', quick)

    def test_quick_syncs_current_truth_without_mode_upgrade(self):
        quick = subsection(text('AGENTS.md'), 'Quick')
        self.assertIn('若实现改变已有 Current Truth', quick)
        self.assertIn('Main 在同一上下文同步受影响快照', quick)
        self.assertIn('不因此升级 SDD', quick)

    def test_sdd_requires_complete_planning_before_execution(self):
        sdd = subsection(text('AGENTS.md'), 'SDD')
        for name in ('完整 C01 Change + C02 Design + C03 Task Graph + 全部 Task Design',
                     '整图可执行后才冻结和派发执行',
                     'Main 不重新拆分'):
            self.assertIn(name, sdd)
        change = text('sdd-change/SKILL.md')
        self.assertIn('Architect 使用 Node `open-spec-mesh new-task` 命令形成完整 Task Graph', change)
        for value in ('产品模块 / 功能 / 规则', '接口 / 协议及兼容', '领域模型 / 状态机 / 不变量', '表 / 字段 / 索引 / 约束 / 数据迁移', '总业务流程 / 主时序'):
            self.assertIn(value, change)

    def test_document_contract_is_review_first(self):
        contract = text('sdd-init/references/document-contract.md')
        self.assertIn('文档首先服务人类 Review', contract)
        self.assertIn('C03-task-graph.json', contract)
        self.assertIn('Current 写最终事实，Change 写 Delta', contract)
        self.assertIn('AC / Dxxx / Task ID 第一次出现时“编号 + 语义”', contract)

    def test_design_and_task_have_distinct_single_sources(self):
        change = text('sdd-change/SKILL.md')
        self.assertIn('Design 的「Task 关系与设计落点」', change)
        self.assertIn('每个 Task Contract 是可实施的小设计', change)
        self.assertIn('完整设计前置', change)
        self.assertIn('整张 Graph、Design 和全部 Task Contract 一次性交付', change)
        contract = text('sdd-init/references/document-contract.md')
        self.assertIn('Worker 拿到 Task 后不应再猜主要实现结构', contract)
        self.assertIn('每个 Task 至少一个真实 Mermaid', contract)
        self.assertIn('公共规则只在 Design 写一次', contract)

    def test_main_knows_only_its_own_delegate_set(self):
        rules = text('AGENTS.md')
        self.assertIn('## 2. 我的委派', rules)
        self.assertIn('Main 只需要知道自己可以委派的角色', rules)
        for role in ('Architect', 'Worker', 'Reviewer', 'Explorer', 'Librarian'):
            self.assertIn(f'| {role} |', rules)
        self.assertNotIn('Architect 只可继续委派', rules)
        self.assertNotIn('Worker、Reviewer、Explorer、Librarian 不可继续委派', rules)

    def test_main_knows_architect_close_time_snapshot_sync(self):
        rules = text('AGENTS.md')
        line = next(line for line in rules.splitlines() if line.startswith('| Architect |'))
        self.assertIn('验收集成后需要同步受影响 Current Truth', line)

    def test_main_coordination_parallelism_and_convergence_are_explicit(self):
        rules = text('AGENTS.md')
        for heading in ('## 3. 协调方法', '## 4. 并行与会话', '## 5. 结果收敛'):
            self.assertIn(heading, rules)
        self.assertIn('已有 Task / Agent session 覆盖同一目标时优先恢复', rules)
        self.assertIn('不要用 resume 作为进度查询', rules)
        self.assertIn('主动轮询至少间隔 **30 分钟**', rules)
        self.assertIn('status / result / evidence / artifacts / blockers', rules)
        self.assertIn('多个结果冲突', rules)

    def test_task_split_parallelism_and_validation_ownership_are_explicit(self):
        rules = text('AGENTS.md')
        architect = text('agents/architect.toml')
        worker = text('agents/worker.toml')
        close = text('sdd-close/SKILL.md')
        task_template = text('sdd-change/references/sdd-task-contract-template.md')

        self.assertIn('Task 按业务模块和可验收结果拆分', rules)
        self.assertIn('路径重叠本身不是禁止并行的理由', rules)
        self.assertIn('并行写任务必须使用独立 worktree', rules)
        self.assertIn('复杂冲突可回派原 Worker 之一处理，不新增业务 Task', rules)
        self.assertIn('任何失败都必须修到通过', rules)

        self.assertIn('业务模块优先', architect)
        self.assertIn('代码落点重叠不是授权判断', architect)
        self.assertIn('Task 实施范围由冻结的业务目标、纳入/排除项和 AC 表达', architect)
        self.assertIn('在冻结 Task 的目标、纳入/排除项、AC 和局部设计内实现', worker)
        self.assertIn('不要反复运行项目全量测试', worker)
        self.assertIn('不维护存量失败、已知失败或 baseline failure 豁免', close)
        self.assertIn('最终全量验证前退役已完成 Worker 的 Git worktree', close)
        self.assertIn('禁止 `--force` 丢弃', close)

        self.assertIn('### 代码结构 / 模块落点', task_template)
        self.assertIn('### 验收标准', task_template)
        self.assertNotIn('### Path Contract', task_template)
        self.assertIn('只运行当前 Task 直接相关的定向测试', task_template)

    def test_common_dispatch_contract_has_no_global_routing_table(self):
        dispatch = text('agents/dispatch-contract.md')
        self.assertIn('不维护全局 Routing Graph', dispatch)
        self.assertIn('自己角色说明允许的 delegate', dispatch)
        self.assertNotIn('## 2. SDD 状态与确定性路由', dispatch)
        self.assertNotIn('## 3. 语义路由', dispatch)
        self.assertNotIn('## 4. 权限', dispatch)
        self.assertNotIn('Quick：Main 可委派', dispatch)
        self.assertNotIn('Architect 只可继续委派', dispatch)

    def test_stage_skills_do_not_define_global_agent_topology(self):
        change = text('sdd-change/SKILL.md')
        do = text('sdd-do/SKILL.md')
        research = text('sdd-research/SKILL.md')
        self.assertIn('需要调查时只按 Role Prompt 委派 Explorer / Librarian', change)
        self.assertIn('本 Skill 不描述其他角色或全局 Routing', do)
        self.assertIn('本 Skill 不定义谁可以委派谁', research)

    def test_old_mode_upgrade_signals_are_absent_from_execution_guidance(self):
        paths = ['AGENTS.md', 'sdd-do/SKILL.md', 'sdd-change/SKILL.md',
                 'sdd-close/SKILL.md', 'agents/worker.toml', 'agents/architect.toml']
        for path in paths:
            body = text(path)
            self.assertNotIn('complexity_upgrade_required', body, path)
            self.assertNotIn('complex_mode_candidate', body, path)
            self.assertNotIn('complex_approval_missing', body, path)
        self.assertIn('contract_change_required', text('agents/worker.toml'))


if __name__ == '__main__':
    unittest.main()
