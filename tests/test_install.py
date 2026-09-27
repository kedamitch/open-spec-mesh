"""Installer failure-injection tests: no accidental deletion, safe retry and merge."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT/'scripts/install.py')
installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)


def snapshot(root):
    if not root.exists(): return {}
    return {str(p.relative_to(root)): (p.read_bytes(), p.stat().st_mode & 0o777)
            for p in root.rglob('*') if p.is_file()}


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sdd-install-test-'); self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)/'home'

    def fixture(self):
        self.home.mkdir()
        for relative in ['docs/original.md','agents/worker.toml','agents/custom.toml','skills/sdd-do/user.txt',
                         'skills/sdd-plan/old','skills/sdd-execute/old','skills/custom/keep','index.md']:
            path=self.home/relative; path.parent.mkdir(parents=True,exist_ok=True); path.write_text('original '+relative)
        (self.home/'AGENTS.md').write_text('user rules\n')
        (self.home/'config.toml').write_text('model_provider="user"\nmodel="old"\n[mcp_servers.keep]\ncommand="keep"\n[agents]\nmax_concurrent_threads_per_session=10\n[agents.custom]\ndescription="user role"\nconfig_file="agents/custom.toml"\n')
        os.chmod(self.home/'config.toml',0o640)
        return snapshot(self.home)

    def install(self, **kw):
        # Keep the original full-install failure points covered explicitly.
        # Runtime-only defaults and legacy-doc preservation have separate tests.
        kw.setdefault('include_project_docs', True)
        return installer.install(ROOT,self.home,validate=False,**kw)

    def test_staging_failure_preserves_every_existing_file(self):
        before=self.fixture()
        with patch.object(installer,'build_stage',side_effect=OSError('injected stage failure')):
            with self.assertRaises(OSError): self.install()
        self.assertEqual(before,snapshot(self.home))

    def test_partial_install_failure_restores_exact_bytes_and_modes(self):
        before=self.fixture(); original=installer.os.replace
        def fail(src,dst):
            if Path(dst)==self.home/'skills/sdd-do' and '.sdd-do.' in str(src):
                raise OSError('injected install failure')
            return original(src,dst)
        with patch.object(installer.os,'replace',side_effect=fail):
            with self.assertRaises(OSError): self.install()
        self.assertEqual(before,snapshot(self.home))

    def test_backup_failure_restores_only_moved_paths(self):
        before=self.fixture(); original=installer.os.replace
        def fail(src,dst):
            if str(src)==str(self.home/'docs'): raise OSError('injected backup failure')
            return original(src,dst)
        with patch.object(installer.os,'replace',side_effect=fail):
            with self.assertRaises(OSError): self.install()
        self.assertEqual(before,snapshot(self.home))

    def test_cleanup_failure_does_not_rollback_successful_install(self):
        self.fixture(); original=installer.shutil.rmtree; leftovers=[]
        def fail(path,*args,**kwargs):
            if Path(path).name.startswith('.sdd-install-'):
                leftovers.append(Path(path)); raise OSError('cleanup failure')
            return original(path,*args,**kwargs)
        with patch.object(installer.shutil,'rmtree',side_effect=fail): warnings=self.install()
        self.assertTrue(warnings)
        self.assertFalse((self.home/'docs/original.md').exists())
        self.assertTrue((self.home/'skills/sdd-do/SKILL.md').exists())
        for path in leftovers:
            if path.exists(): original(path)

    def test_fresh_install_failure_leaves_no_half_installation(self):
        original=installer.os.replace
        def fail(src,dst):
            if Path(dst)==self.home/'config.toml': raise OSError('injected')
            return original(src,dst)
        with patch.object(installer.os,'replace',side_effect=fail):
            with self.assertRaises(OSError): self.install()
        self.assertEqual({},snapshot(self.home))

    def test_idempotence_user_config_and_custom_roles_preserved(self):
        self.fixture(); self.install()
        cfg=tomllib.loads((self.home/'config.toml').read_text())
        self.assertEqual('user',cfg['model_provider']); self.assertEqual('keep',cfg['mcp_servers']['keep']['command'])
        self.assertEqual('live',cfg['web_search'])
        for server in ('codegraph','context7','tavily'):
            self.assertIn(server,cfg['mcp_servers'])
        self.assertEqual(['CONTEXT7_API_KEY'],cfg['mcp_servers']['context7']['env_vars'])
        self.assertEqual(['TAVILY_API_KEY'],cfg['mcp_servers']['tavily']['env_vars'])
        self.assertEqual(10,cfg['features']['multi_agent_v2']['max_concurrent_threads_per_session'])
        self.assertNotIn('max_concurrent_threads_per_session',cfg['agents'])
        self.assertNotIn('max_depth',cfg['agents'])
        self.assertEqual('user role',cfg['agents']['custom']['description'])
        self.assertTrue((self.home/'agents/custom.toml').exists()); self.assertTrue((self.home/'skills/custom/keep').exists())
        self.assertFalse((self.home/'skills/sdd-plan').exists()); self.assertFalse((self.home/'skills/sdd-execute').exists())
        self.assertEqual(0o640,(self.home/'config.toml').stat().st_mode&0o777)
        text=(self.home/'AGENTS.md').read_text(); self.assertIn('user rules',text)
        self.install()
        self.assertEqual(text,(self.home/'AGENTS.md').read_text())
        self.assertEqual(1,text.count(installer.BEGIN)); self.assertFalse((self.home/'backups').exists())
        for role in ('architect','worker','reviewer','explorer','librarian'):
            role_cfg=tomllib.loads((self.home/f'agents/{role}.toml').read_text())
            self.assertNotIn('agents',role_cfg)
            self.assertNotIn('features',role_cfg)

    def test_research_tool_bootstrap_installs_latest_into_codex_home(self):
        self.home.mkdir()
        calls=[]
        def which(name):
            return {'npm':'/usr/bin/npm','node':'/usr/bin/node'}.get(name)
        def run(command, **kwargs):
            calls.append(command)
            if command[0]=='/usr/bin/node':
                return subprocess.CompletedProcess(command,0,'v20.18.1\n','')
            prefix=Path(command[command.index('--prefix')+1])
            bindir=prefix/'node_modules/.bin'; bindir.mkdir(parents=True,exist_ok=True)
            package=command[-1].removesuffix('@latest')
            binary=next(item[2] for item in installer.RESEARCH_TOOLS if item[1]==package)
            package_dir=prefix/'node_modules'/package
            package_dir.mkdir(parents=True,exist_ok=True)
            (package_dir/'package.json').write_text(json.dumps({'name':package}))
            entry=package_dir/'cli.js'; entry.write_text('tool'); entry.chmod(0o755)
            (bindir/binary).symlink_to(os.path.relpath(entry,bindir))
            return subprocess.CompletedProcess(command,0,'','')
        with patch.dict(os.environ, {'CONTEXT7_API_KEY':'fixture-context7', 'TAVILY_API_KEY':'fixture-tavily'}), \
             patch.object(installer.shutil,'which',side_effect=which), patch.object(installer.subprocess,'run',side_effect=run):
            commands=installer.ensure_research_tools(self.home)
        npm_calls=[command for command in calls if command[0]=='/usr/bin/npm']
        for server,package,binary,_ in installer.RESEARCH_TOOLS:
            self.assertIn(package+'@latest',[command[-1] for command in npm_calls])
            self.assertEqual(self.home/installer.TOOLS_DIR/server/'node_modules/.bin'/binary,Path(commands[server]))

    def test_research_tool_bootstrap_preserves_custom_mcp(self):
        self.home.mkdir()
        (self.home/'config.toml').write_text('[mcp_servers.context7]\nurl="https://example.test/mcp"\n')
        reports=[]
        with patch.object(installer.shutil,'which',return_value='/usr/bin/tool'):
            commands=installer.ensure_research_tools(self.home,dry_run=True,reporter=reports.append)
        self.assertNotIn('context7',commands)
        self.assertTrue(any('preserve mcp_servers.context7' in line for line in reports))

    def test_dry_run_validates_without_touching_target(self):
        before=self.fixture(); self.install(dry_run=True); self.assertEqual(before,snapshot(self.home))

    def test_dry_run_new_target_remains_absent(self):
        self.install(dry_run=True); self.assertFalse(self.home.exists())

    def test_invalid_existing_config_fails_before_mutation_even_dry_run(self):
        self.fixture(); (self.home/'config.toml').write_text('broken [toml'); before=snapshot(self.home)
        with self.assertRaises(ValueError): self.install(dry_run=True)
        self.assertEqual(before,snapshot(self.home))

    def test_no_final_newline_is_safe(self):
        self.fixture(); (self.home/'config.toml').write_text('model_provider="keep"')
        self.install(); self.assertEqual('keep',tomllib.loads((self.home/'config.toml').read_text())['model_provider'])

    def test_symlink_target_is_rejected_without_following(self):
        self.home.mkdir(); victim=Path(self.tmp.name)/'victim'; victim.write_text('keep')
        (self.home/'config.toml').symlink_to(victim)
        with self.assertRaises(ValueError): self.install()
        self.assertEqual('keep',victim.read_text())

    def test_symlink_parent_is_rejected(self):
        real=Path(self.tmp.name)/'real'; real.mkdir(); link=Path(self.tmp.name)/'link'; link.symlink_to(real, target_is_directory=True)
        with self.assertRaises(ValueError): installer.install(ROOT,link/'home',validate=False)
        self.assertEqual([],list(real.iterdir()))

    def test_overlapping_source_and_target_rejected(self):
        with self.assertRaises(ValueError): installer.install(ROOT,ROOT/'home',validate=False)

    def test_cli_validation_and_bash_syntax(self):
        result=subprocess.run(['bash',str(ROOT/'install.sh'),'--codex-home',str(self.home),'--dry-run'],capture_output=True,text=True)
        self.assertEqual(0,result.returncode,result.stderr)
        self.assertEqual(0,subprocess.run(['bash','-n',str(ROOT/'install.sh')],capture_output=True).returncode)


if __name__=='__main__': unittest.main()
