"""Retirement, manifest conversion, safe TOML and exact rule ownership regressions."""
import json
from pathlib import Path
import tempfile
import tomllib
import unittest
from unittest.mock import patch
import test_install

installer = test_install.installer
migration = installer.migration
from install_toml import DELETE, set_value
ROOT = Path(__file__).resolve().parents[1]


def snapshot(root):
    return {str(p.relative_to(root)):(p.read_bytes(),p.stat().st_mode & 0o777)
            for p in root.rglob('*') if p.is_file() and not p.is_symlink()}


class RuleTests(unittest.TestCase):
    old = '# Old package rules\n\n[flow](sdd-plan/references/policy.md)\n'
    current = '# New package rules\n\nCurrent.\n'
    def clean(self,text):
        return migration.clean_agents(text,self.current,{migration.blob_hash(self.old.encode())})
    def test_fingerprint_removes_exact_block_only(self):
        prefix='# User rules\nDo not deploy.\n\n';suffix='\n# User tail\nPreserve.\n'
        text,_,n,_=self.clean(prefix+self.old+suffix)
        self.assertEqual(1,n);self.assertTrue(text.startswith(prefix+migration.BEGIN));self.assertTrue(text.endswith(suffix))
    def test_unrecognized_edited_rules_are_not_deleted(self):
        text=self.old.replace('Old package','User edited')
        cleaned,_,n,warnings=self.clean(text)
        self.assertEqual(0,n);self.assertTrue(cleaned.startswith(text));self.assertTrue(warnings)
    def test_multiple_managed_blocks_collapse(self):
        block=migration.BEGIN+'\nold\n'+migration.END+'\n'
        clean,marked,_,_=self.clean('prefix\n'+block+'middle\n'+block+'tail\n')
        self.assertEqual(2,marked);self.assertEqual(1,clean.count(migration.BEGIN));self.assertTrue(clean.endswith('middle\ntail\n'))
        self.assertEqual(clean,self.clean(clean)[0])
    def test_crlf_and_installed_links_match(self):
        text=self.old.replace('](sdd-plan/','](skills/sdd-plan/').replace('\n','\r\n').rstrip()
        cleaned,_,n,_=self.clean(text)
        self.assertEqual(1,n);self.assertNotIn('sdd-plan',cleaned)
    def test_examples_and_user_bytes_preserved(self):
        example='````markdown\n'+self.old+migration.BEGIN+'\nold\n'+migration.END+'\n````\n'
        cleaned,m,n,_=self.clean(example)
        self.assertEqual((0,0),(m,n));self.assertTrue(cleaned.startswith(example))
    def test_malformed_markers_fail_closed(self):
        for s in (migration.BEGIN,migration.END,migration.BEGIN+'\n'+migration.BEGIN+'\n'+migration.END):
            with self.assertRaises(ValueError):self.clean(s)


class TomlTests(unittest.TestCase):
    def test_inline_dotted_and_quoted_roles(self):
        for text in ('agents={e2e={model="old"},custom={model="mine"}}\n',
                     'agents.e2e.model="old"\nagents.custom.model="mine"\n',
                     '[agents."e2e"]\nmodel="old"\n[agents.custom]\nmodel="mine"\n'):
            actual=installer.merge_config(ROOT,text,['e2e']);d=tomllib.loads(actual)
            self.assertNotIn('e2e',d['agents']);self.assertEqual('mine',d['agents']['custom']['model'])
            self.assertNotIn('max_depth',d['agents']);self.assertIs(True,d['features']['multi_agent_v2']['enabled']);self.assertEqual(4,d['features']['multi_agent_v2']['max_concurrent_threads_per_session'])
    def test_multiline_prompt_cannot_be_a_section(self):
        text='[agents.custom]\nprompt="""\n[agents.e2e]\nmodel="not a real entry"\n"""\n[agents.e2e]\nmodel="old"\n'
        got=set_value(text,('agents','e2e'),DELETE)
        self.assertEqual(tomllib.loads(text)['agents']['custom'],tomllib.loads(got)['agents']['custom'])
    def test_current_role_overrides_replaced(self):
        text='[agents.architect]\nmodel="stale"\nconfig_file="old.toml"\n[agents.architect.tools]\nenabled=false\n'
        data=tomllib.loads(installer.merge_config(ROOT,text))
        self.assertEqual({'description','config_file'},set(data['agents']['architect']))
    def test_unrelated_arrays_dates_and_nan_survive(self):
        text='date=2020-01-01\nnan_value=nan\n[[tools]]\nname="one"\n[[tools]]\nname="two"\n[agents."my.role"]\nconfig_file="mine.toml"'
        data=tomllib.loads(installer.merge_config(ROOT,text));before=tomllib.loads(text)
        self.assertEqual(before['tools'],data['tools']);self.assertEqual(before['date'],data['date']);self.assertEqual(before['agents']['my.role'],data['agents']['my.role'])


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.home=Path(self.tmp.name)/'home';self.home.mkdir()
        for name in migration.LEGACY_SKILLS:
            p=self.home/'skills'/name/'SKILL.md';p.parent.mkdir(parents=True);p.write_text('old')
        for path in (*migration.LEGACY_ROLES.values(),*migration.LEGACY_AUX,'agents/custom.toml','skills/sdd-custom/SKILL.md'):
            p=self.home/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('old' if 'custom' not in path else 'user')
        (self.home/'agents/README.md').write_text('# Personal agents\nSubagent: implementer and e2e.\n')
        (self.home/'config.toml').write_text('model_provider="mine"\n[agents]\nmax_threads=9\n[agents.implementer]\nconfig_file="agents/implementer.toml"\n[agents.e2e]\nconfig_file="agents/e2e.toml"\n[agents.old_alias]\nconfig_file="agents/e2e.toml"\n[agents.custom]\nconfig_file="agents/custom.toml"\n[mcp_servers.mine]\ncommand="keep"\n')
        (self.home/'AGENTS.md').write_text('# User\nNever deploy.\n')
        (self.home/'config.toml').chmod(0o640)
    def install(self,**kwargs):return installer.install(ROOT,self.home,validate=False,**kwargs)
    def test_cleanup_all_surfaces_preserves_custom(self):
        messages=[];self.install(reporter=messages.append)
        for name in migration.LEGACY_SKILLS:self.assertFalse((self.home/'skills'/name).exists())
        for path in (*migration.LEGACY_ROLES.values(),*migration.LEGACY_AUX,'agents/README.md'):self.assertFalse((self.home/path).exists())
        cfg=tomllib.loads((self.home/'config.toml').read_text())
        self.assertTrue({'implementer','e2e','old_alias'}.isdisjoint(cfg['agents']))
        self.assertEqual('mine',cfg['model_provider']);self.assertNotIn('max_threads',cfg['agents']);self.assertEqual(9,cfg['features']['multi_agent_v2']['max_concurrent_threads_per_session'])
        self.assertTrue((self.home/'agents/custom.toml').exists());self.assertTrue((self.home/'skills/sdd-custom/SKILL.md').exists())
        self.assertEqual(0o640,(self.home/'config.toml').stat().st_mode&0o777)
        self.assertIn('  UNREGISTER agents.implementer',messages)
        self.assertTrue((self.home/migration.MANIFEST).is_file())
        before=snapshot(self.home);self.install();self.assertEqual(before,snapshot(self.home))
    def test_personal_readme_preserved(self):
        p=self.home/'agents/README.md';p.write_text('# My agents\nKeep my personal workflows.\n');self.install();self.assertTrue(p.exists())
    def test_repurposed_role_registration_preserved(self):
        p=self.home/'config.toml';p.write_text(p.read_text().replace('agents/implementer.toml','custom/implementer.toml'))
        self.install();self.assertEqual('custom/implementer.toml',tomllib.loads(p.read_text())['agents']['implementer']['config_file'])
    def test_dryrun_lists_plan_no_secret_or_mutation(self):
        before=snapshot(self.home);out=[];self.install(dry_run=True,reporter=out.append)
        self.assertEqual(before,snapshot(self.home));self.assertFalse((self.home/migration.MANIFEST).exists())
        self.assertTrue(any('DELETE skills/sdd-project-init' in s for s in out));self.assertFalse(any('Never deploy' in s for s in out))
    def test_new_manifest_future_retirement(self):
        p=self.home/'skills/retired-future/SKILL.md';p.parent.mkdir(parents=True);p.write_text('old')
        (self.home/migration.MANIFEST).write_text(json.dumps({'schema':1,'skills':['retired-future'],'roles':[]}))
        self.install();self.assertFalse(p.exists())
    def test_old_manifest_migrates_to_latest(self):
        p=self.home/'agents/retired.toml';p.write_text('old')
        (self.home/migration.OLD_MANIFEST).write_text(json.dumps({'schema_version':1,'package':migration.PACKAGE,'skills':[],'roles':{'retired':'agents/retired.toml'}}))
        self.install();self.assertFalse(p.exists());self.assertFalse((self.home/migration.OLD_MANIFEST).exists());self.assertTrue((self.home/migration.MANIFEST).exists())
    def test_manifest_failure_restores_retired_files_and_config(self):
        before=snapshot(self.home);real=installer.os.replace
        def fail(src,dst):
            if Path(dst)==self.home/migration.MANIFEST:raise OSError('manifest install failure')
            return real(src,dst)
        with patch.object(installer.os,'replace',side_effect=fail):
            with self.assertRaises(OSError):self.install()
        self.assertEqual(before,snapshot(self.home))
    def test_unsafe_manifest_is_nondestructive(self):
        for data in ({'schema':1,'skills':['../../escape'],'roles':[]},{'schema':1,'skills':[],'roles':['../bad']}, {'schema':99,'skills':[],'roles':[]}):
            (self.home/migration.MANIFEST).write_text(json.dumps(data));before=snapshot(self.home)
            with self.assertRaises(ValueError):self.install()
            self.assertEqual(before,snapshot(self.home))
    def test_manifest_symlink_rejected(self):
        p=self.home/migration.MANIFEST;p.symlink_to(self.home/'config.toml')
        with self.assertRaises(ValueError):self.install()
        self.assertTrue(p.is_symlink())

if __name__=='__main__':unittest.main()
