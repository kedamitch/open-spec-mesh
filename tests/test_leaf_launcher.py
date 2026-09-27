"""Validate leaf launch overrides without invoking paid models."""
from pathlib import Path
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'sdd-do/scripts'))
import run_leaf
class LeafLauncherTests(unittest.TestCase):
    def test_session_overrides_disable_delegation(self):
        args=run_leaf.command('codex',ROOT/'agents/worker.toml',ROOT)
        self.assertIn('agents.enabled=false',args)
        self.assertIn('features.multi_agent=false',args)
        self.assertIn('features.multi_agent_v2=false',args)
        self.assertIn('model="gpt-6-luna"',args)
    def test_read_only_evidence_roles(self):
        for role in ('reviewer','explorer','librarian'):
            self.assertIn('sandbox_mode="read-only"',run_leaf.command('codex',ROOT/f'agents/{role}.toml',ROOT))
    def test_reject_architect_and_invalid_thread(self):
        with self.assertRaises(ValueError):run_leaf.command('codex',ROOT/'agents/architect.toml',ROOT)
        with self.assertRaises(ValueError):run_leaf.command('codex',ROOT/'agents/worker.toml',ROOT,'--last')
    def test_resume_exact_thread(self):
        thread='11111111-1111-4111-8111-111111111111'
        args=run_leaf.command('codex',ROOT/'agents/worker.toml',ROOT,thread)
        self.assertEqual(['exec','resume',thread,'--json','--skip-git-repo-check','-'],args[-6:])
if __name__=='__main__':unittest.main()
