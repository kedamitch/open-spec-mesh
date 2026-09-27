"""Validate leaf launch overrides without invoking paid models."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
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


class MultiHostLeafLauncherTests(unittest.TestCase):
    def test_opencode_command_uses_named_agent_exact_workspace_and_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            args,env=run_leaf.host_command(
                'opencode','opencode','worker',root,'ses_123456','/tmp/opencode-home')
            self.assertEqual('opencode',args[0])
            self.assertEqual(['run','--agent','worker'],args[1:4])
            self.assertIn('--format',args)
            self.assertEqual('ses_123456',args[args.index('--session')+1])
            self.assertEqual('/tmp/opencode-home',env['OPENCODE_CONFIG_DIR'])
            self.assertEqual('/tmp/opencode-home/open-spec-mesh.opencode.json',
                             env['OPENCODE_CONFIG'])
            self.assertNotIn('--dir',args)
            self.assertNotIn('worktree',args)

    def test_claude_command_uses_named_agent_resume_and_mcp_overlay(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            args,env=run_leaf.host_command(
                'claude','claude','reviewer',root,'session-123456','/tmp/claude-home')
            self.assertEqual(['claude','-p','--agent','reviewer'],args[:4])
            self.assertEqual('session-123456',args[args.index('--resume')+1])
            self.assertEqual('/tmp/claude-home/open-spec-mesh.mcp.json',
                             args[args.index('--mcp-config')+1])
            self.assertEqual({},env)
            self.assertNotIn('--worktree',args)

    def test_non_codex_session_ids_are_exact_but_not_forced_to_uuid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            run_leaf.host_command('opencode','opencode','worker',root,'ses_abcd-1234','/tmp/o')
            run_leaf.host_command('claude','claude','worker',root,'named-session-1','/tmp/c')
            with self.assertRaises(ValueError):
                run_leaf.host_command('opencode','opencode','worker',root,'bad id','/tmp/o')

    def test_auto_host_preserves_codex_preference_and_refuses_ambiguity(self):
        with mock.patch.object(run_leaf.shutil,'which') as which:
            which.side_effect=lambda name:'/bin/'+name if name=='codex' else None
            self.assertEqual('codex',run_leaf.resolve_host('auto'))
        with unittest.mock.patch.object(run_leaf.shutil,'which') as which:
            which.side_effect=lambda name:'/bin/'+name if name in ('opencode','claude') else None
            with self.assertRaisesRegex(ValueError,'Multiple'):
                run_leaf.resolve_host('auto')
