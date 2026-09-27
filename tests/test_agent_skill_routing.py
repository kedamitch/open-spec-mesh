"""Check actual role/Skill wiring and installed paths, not entire prompt sentences."""
import json
from pathlib import Path
import re
import sys
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'sdd-do/scripts'))
sys.path.insert(0, str(ROOT / 'agents'))
import install as installer
import run_leaf
import validate_agents as agent_validator

EXPECTED_SKILLS = {
    'architect': {'sdd-change', 'sdd-close', 'sdd-research'},
    'worker': {'sdd-do'}, 'reviewer': {'sdd-do'},
    'explorer': {'sdd-research'}, 'librarian': {'sdd-research'},
}
REFERENCE = re.compile(r'`((?:sdd-[a-z-]+|prd-spec|design-overview)/(?:SKILL\.md|references/[a-z0-9-]+\.md))`')


def prompt(root, role):
    return tomllib.loads((root / 'agents' / f'{role}.toml').read_text(encoding='utf-8'))['developer_instructions']


class AgentSkillRoutingTests(unittest.TestCase):
    def test_role_skill_dependencies(self):
        for role, expected in EXPECTED_SKILLS.items():
            with self.subTest(role=role):
                text = prompt(ROOT, role)
                self.assertIn('## Skill 使用', text)
                actual = {p.split('/')[0] for p in REFERENCE.findall(text) if p.endswith('/SKILL.md')}
                self.assertEqual(expected, actual)

    def test_writing_guides_are_references_not_extra_stages(self):
        text = prompt(ROOT, 'architect')
        for name in ('product-writing', 'architecture-writing'):
            self.assertIn(f'sdd-init/references/{name}.md', REFERENCE.findall(text))
        for name in ('prd-spec', 'design-overview'):
            self.assertNotIn(f'{name}/SKILL.md', REFERENCE.findall(text))
            self.assertTrue((ROOT/name/'SKILL.md').is_file())
            self.assertLess(len((ROOT/name/'SKILL.md').read_text()), 600)

    def test_prompt_roots_and_bounded_context(self):
        for role in EXPECTED_SKILLS:
            with self.subTest(role=role):
                text = prompt(ROOT, role)
                self.assertIn('$CODEX_HOME/skills/', text)
                self.assertIn('~/.codex/skills/', text)
                self.assertLessEqual(len(text), 4500)

    def test_role_prompts_are_structured_working_guides(self):
        common = ('## 角色定位', '## 适用与不适用', '## Skill 使用')
        specific = {
            'architect': ('## 核心职责', '## 工作方法', '## 我的委派', '## 设计与拆分原则', '## 边界与停止'),
            'worker': ('## 核心职责', '## 工作方法', '## 判断与停止原则', '## 委派', '## 恢复与交付'),
            'reviewer': ('## 审查方法', '## Finding 分级', '## 边界、返工与恢复', '## 委派'),
            'explorer': ('## 调查方法', '## 边界与恢复', '## 委派'),
            'librarian': ('## 调查方法', '## 边界与恢复', '## 委派'),
        }
        for role in EXPECTED_SKILLS:
            with self.subTest(role=role):
                text = prompt(ROOT, role)
                for heading in (*common, *specific[role]):
                    self.assertIn(heading, text)
                self.assertIn('恢复同一任务', text)

    def test_specialists_only_receive_local_delegation_authority(self):
        roles = {name: prompt(ROOT, name) for name in EXPECTED_SKILLS}
        self.assertIn('Explorer', roles['architect'])
        self.assertIn('Librarian', roles['architect'])
        self.assertFalse(agent_validator.has_positive_delegation(
            roles['architect'], {'Main', 'Worker', 'Reviewer'}))

        for role in ('worker', 'reviewer', 'explorer', 'librarian'):
            self.assertIn('不可委派任何 Agent', roles[role])
            self.assertFalse(agent_validator.has_positive_delegation(
                roles[role], agent_validator.ROLE_REFERENCES), role)

    def test_dispatch_contract_is_installed(self):
        self.assertTrue((ROOT/'agents/dispatch-contract.md').is_file())
        with tempfile.TemporaryDirectory(prefix='sdd-dispatch-') as tmp:
            home = Path(tmp)/'codex'
            installer.install(ROOT, home, validate=False)
            self.assertEqual((ROOT/'agents/dispatch-contract.md').read_text(),
                             (home/'agents/dispatch-contract.md').read_text())

    def test_declared_source_references_exist(self):
        for role in EXPECTED_SKILLS:
            for relative in REFERENCE.findall(prompt(ROOT, role)):
                with self.subTest(role=role, path=relative):
                    self.assertTrue((ROOT / relative).is_file(), relative)

    def test_install_keeps_prompts_and_references_resolvable(self):
        with tempfile.TemporaryDirectory(prefix='sdd-skill-routing-') as tmp:
            home = Path(tmp) / 'codex'
            installer.install(ROOT, home, validate=False)
            for role in EXPECTED_SKILLS:
                self.assertEqual(prompt(ROOT, role), prompt(home, role))
                self.assertFalse((home/'skills/typesafe-laya').exists())
                for relative in REFERENCE.findall(prompt(home, role)):
                    self.assertTrue((home / 'skills' / relative).is_file(), relative)
            self.assertEqual([], installer.install(ROOT, home, dry_run=True, validate=False))

            installer.install(ROOT, home, validate=False, with_laya=True)
            for role in EXPECTED_SKILLS:
                self.assertEqual(prompt(ROOT, role) + installer.laya_policy(), prompt(home, role))
            self.assertTrue((home/'skills/typesafe-laya/SKILL.md').is_file())

    def test_strict_leaf_fallback_forwards_exact_instructions(self):
        for role in run_leaf.LEAVES:
            args = run_leaf.command('codex', ROOT / 'agents' / f'{role}.toml', ROOT)
            encoded = next(arg for arg in args if arg.startswith('developer_instructions='))
            self.assertEqual(prompt(ROOT, role), json.loads(encoded.split('=', 1)[1]))


if __name__ == '__main__':
    unittest.main()
