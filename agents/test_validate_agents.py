"""Static GPT-6 / Multi-Agent V2 configuration regression tests."""
import copy
from pathlib import Path
import shutil
import tempfile
import tomllib
import unittest
import validate_agents as validator


class AgentConfigurationTest(unittest.TestCase):
    def test_current_config(self):
        self.assertEqual([], validator.validate())

    def test_invalid_main_settings(self):
        current = tomllib.loads((validator.ROOT/'config.toml').read_text())
        cases = [
            ('model', 'wrong'),
            ('features', None),
            ('features.multi_agent_v2.enabled', False),
            ('features.multi_agent_v2.max_concurrent_threads_per_session', 0),
            ('features.multi_agent_v2.tool_namespace', 'wrong'),
            ('features.multi_agent_v2.hide_spawn_agent_metadata', True),
            ('features.multi_agent_v2.expose_spawn_agent_model_overrides', True),
            ('agents.enabled', False),
            ('agents.default_subagent_model', 'wrong'),
            ('agents.worker', None),
        ]
        for path, value in cases:
            with self.subTest(path=path):
                data = copy.deepcopy(current)
                dst = data
                parts = path.split('.')
                for part in parts[:-1]:
                    dst = dst[part]
                dst[parts[-1]] = value
                self.assertTrue(validator.validate_runtime_config(data))

    def test_legacy_v1_runtime_settings_are_rejected(self):
        current = tomllib.loads((validator.ROOT/'config.toml').read_text())
        for key in ('max_depth', 'max_threads', 'max_concurrent_threads_per_session'):
            with self.subTest(key=key):
                data = copy.deepcopy(current)
                data['agents'][key] = 2
                self.assertTrue(validator.validate_runtime_config(data))

    def fixture(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        shutil.copy(validator.ROOT/'config.toml', root)
        shutil.copy(validator.ROOT/'AGENTS.md', root)
        shutil.copytree(validator.ROOT/'agents', root/'agents')
        return root

    def test_dispatch_is_common_packet_not_global_router(self):
        root = self.fixture()
        self.assertEqual([], validator.validate(root))
        dispatch = root/'agents/dispatch-contract.md'
        original = dispatch.read_text()

        dispatch.write_text(original.replace('不维护全局 Routing Graph', '维护完整 Routing Graph'))
        self.assertTrue(any('local delegation contract' in e for e in validator.validate(root)))
        dispatch.write_text(original)

        dispatch.write_text(original + '\nQuick：Main 可委派 Explorer、Librarian\n')
        self.assertTrue(any('global routing topology leaked' in e for e in validator.validate(root)))

    def test_main_local_delegate_contract_is_linted(self):
        root = self.fixture()
        rules = root/'AGENTS.md'
        original = rules.read_text()
        rules.write_text(original.replace('## 2. 我的委派', '## 2. 全局路由'))
        self.assertTrue(any('main: local delegation' in e for e in validator.validate(root)))
        rules.write_text(original + '\nArchitect 只可继续委派 Explorer、Librarian\n')
        self.assertTrue(any('main: foreign delegation topology leaked' in e for e in validator.validate(root)))

    def test_role_metadata_and_local_delegation_are_linted(self):
        root = self.fixture()

        config = root/'config.toml'
        explorer = tomllib.loads((root/'agents/explorer.toml').read_text())['description']
        config.write_text(config.read_text().replace(explorer, 'drifted description', 1))
        self.assertTrue(any('config description' in e for e in validator.validate(root)))
        shutil.copy(validator.ROOT/'config.toml', config)

        architect = root/'agents/architect.toml'
        old_architect = architect.read_text()
        architect.write_text(old_architect.replace('## 我的委派', '## 全局 Routing'))
        self.assertTrue(any('architect: planning ownership' in e for e in validator.validate(root)))
        architect.write_text(old_architect.replace('调用方不应重新拆分', '调用方可以重新拆分'))
        self.assertTrue(any('architect: planning ownership' in e for e in validator.validate(root)))
        architect.write_text(old_architect.replace('你不实现代码、不做最终验收。', '你可以委派 Worker 处理实现。你不实现代码、不做最终验收。'))
        self.assertTrue(any('architect: unauthorized delegation authority' in e for e in validator.validate(root)))

        worker = root/'agents/worker.toml'
        old_worker = worker.read_text()
        worker.write_text(old_worker.replace('不可委派任何 Agent', '可以委派 Explorer'))
        errors = validator.validate(root)
        self.assertTrue(any('leaf no-delegation' in e for e in errors))
        self.assertTrue(any('worker: unauthorized delegation authority' in e for e in errors))
        worker.write_text(old_worker.replace('不做第二次规划。', '遇到问题直接调用 Architect。不做第二次规划。'))
        self.assertTrue(any('worker: unauthorized delegation authority' in e for e in validator.validate(root)))

    def test_leaf_cannot_hide_positive_delegation_in_a_list(self):
        root = self.fixture()
        worker = root/'agents/worker.toml'
        worker.write_text(worker.read_text().replace(
            '\n"""\n',
            '\n你只可委派：\n- Explorer\n"""\n',
            1,
        ))
        self.assertTrue(any(
            'worker: unauthorized delegation authority' in e
            for e in validator.validate(root)
        ))

    def test_role_mentions_are_not_mistaken_for_delegation(self):
        root = self.fixture()
        worker = root/'agents/worker.toml'
        original = worker.read_text()
        worker.write_text(original.replace(
            '最终集成验证由 Main 统一执行。',
            '最终集成验证由 Main 统一执行；Worker 不负责最终归档。'))
        self.assertEqual([], validator.validate(root))

    def test_mode_boundaries_are_linted(self):
        root = self.fixture()
        worker = root/'agents/worker.toml'
        old_worker = worker.read_text()
        worker.write_text(old_worker.replace(
            'mode=quick 或缺少 Contract 时返回 permission_denied。',
            'Quick 可以执行。'))
        self.assertTrue(any('Quick prohibition' in e for e in validator.validate(root)))
        worker.write_text(old_worker)

        reviewer = root/'agents/reviewer.toml'
        old_reviewer = reviewer.read_text()
        reviewer.write_text(old_reviewer.replace('仅执行 mode=sdd 且用户明确要求', '仅执行 mode=sdd'))
        self.assertTrue(any('explicit-user SDD' in e for e in validator.validate(root)))

    def test_role_model_effort_and_policy_are_validated(self):
        root = self.fixture()
        architect = root/'agents/architect.toml'
        old = architect.read_text()
        for broken in [
            old.replace('gpt-6-sol', 'gpt-6-luna'),
            old.replace('xhigh', 'high'),
            old.replace('workspace-write', 'read-only'),
            old.replace('fork_turns="none"', 'fork_turns="all"'),
        ]:
            architect.write_text(broken)
            self.assertTrue(validator.validate(root))
        architect.write_text(old)

        worker = root/'agents/worker.toml'
        old = worker.read_text()
        worker.write_text(old + '\n[agents]\nenabled=false\n')
        self.assertTrue(validator.validate(root))


if __name__ == '__main__':
    unittest.main()
