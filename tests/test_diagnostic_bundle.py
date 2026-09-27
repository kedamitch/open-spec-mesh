"""One-command bundles: automatic scope, no extra models, privacy and safe installation."""
import ast
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'sdd-diagnose/scripts/bundle.py'
spec = importlib.util.spec_from_file_location('diagnostic_bundle', SCRIPT)
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
NOW = datetime(2026, 9, 23, 12, tzinfo=timezone.utc)
SECRET = 'sk-DO-NOT-EXPORT-RAW-LOGS'


def envelope(kind, payload, minute=0):
    return {'type': kind, 'timestamp': f'2026-09-23T11:{minute:02d}:00Z', 'payload': payload}


def rows(project, sid='root', role=None, parent=None, turns=1):
    result = [envelope('session_meta', {'id': sid, 'cwd': str(project), 'cli_version': '0.155.1',
                                       'agent_role': role, 'parent_thread_id': parent,
                                       'base_instructions': SECRET})]
    for n in range(turns):
        result += [envelope('event_msg', {'type': 'task_started', 'turn_id': f't{n}'}, n*3),
                   envelope('turn_context', {'turn_id': f't{n}', 'model': 'gpt-6-luna', 'effort': 'max'}, n*3+1),
                   envelope('event_msg', {'type': 'task_complete'}, n*3+2)]
    return result


class BundleSafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.project = self.base/'project'; self.project.mkdir(); (self.project/'.git').mkdir()
        self.home = self.base/'codex'; self.home.mkdir()
        self.sessions = self.home/'sessions'; self.sessions.mkdir()

    def log(self, data, name='root.jsonl'):
        path = self.sessions/name
        path.write_text(''.join(json.dumps(row)+'\n' for row in data))
        return path

    def empty_bundle(self, **kwargs):
        fake = SimpleNamespace(diagnose=SimpleNamespace(summary=lambda _: '', markdown=lambda _: ''))
        selection = {'issues': {'sessions_missing': 1}, 'omitted_older_slices': 0}
        return bundle.write_bundle(self.project, self.home, [], [], selection, fake, now=NOW, **kwargs)

    def test_empty_report_is_useful_not_successful_execution(self):
        result = self.empty_bundle()
        self.assertEqual('no_sessions', result['status'])
        path = Path(result['bundle'])
        self.assertEqual(0o600, path.stat().st_mode & 0o777)
        with zipfile.ZipFile(path) as archive:
            self.assertEqual({'README.md','manifest.json','inventory.json','summary.md'}, set(archive.namelist()))
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(0, manifest['diagnostic_model_calls'])
            for name, digest in manifest['files'].items():
                self.assertEqual(digest, bundle.sha(archive.read(name)))
            self.assertNotIn(str(self.project), archive.read('manifest.json').decode())

    def test_output_never_overwrites_user_file(self):
        output = self.home/'mine.zip'; output.write_bytes(b'keep')
        with self.assertRaises(ValueError): self.empty_bundle(output=output)
        self.assertEqual(b'keep', output.read_bytes())

    def test_project_output_refused(self):
        with self.assertRaises(ValueError): self.empty_bundle(output=self.project/'bundle.zip')

    def test_other_git_tree_output_refused(self):
        other = self.base/'other'; other.mkdir(); (other/'.git').mkdir()
        with self.assertRaises(ValueError): self.empty_bundle(output=other/'bundle.zip')

    def test_output_symlink_refused(self):
        link = self.home/'link'; link.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError): self.empty_bundle(output=link/'bundle.zip')

    def test_failed_publish_cleans_temp(self):
        with patch.object(bundle.os, 'link', side_effect=OSError('disk')):
            with self.assertRaises(OSError): self.empty_bundle()
        self.assertEqual([], list(self.home.rglob('*.zip')))
        self.assertEqual([], list(self.home.rglob('.sdd-bundle-*')))

    def test_repeated_bundle_gets_new_file(self):
        self.assertNotEqual(self.empty_bundle()['bundle'], self.empty_bundle()['bundle'])

    def test_nested_cwd_finds_git_root(self):
        nested = self.project/'a'/'b'; nested.mkdir(parents=True)
        self.assertEqual(self.project, bundle.project_root(nested))

    def test_discovery_excludes_other_projects_and_children(self):
        self.log(rows(self.project), 'root.jsonl')
        self.log(rows(self.base/'other', 'other'), 'other.jsonl')
        self.log(rows(self.project, 'child', 'worker', 'root'), 'child.jsonl')
        indexed, roots, issues = bundle.discover(self.project, self.sessions)
        self.assertEqual({'root', 'other', 'child'}, set(indexed))
        self.assertEqual(['root'], [entry[1] for entry in roots])
        self.assertFalse(issues)

    def test_duplicate_session_has_no_arbitrary_winner(self):
        self.log(rows(self.project), 'a.jsonl'); self.log(rows(self.project), 'b.jsonl')
        indexed, roots, issues = bundle.discover(self.project, self.sessions)
        self.assertFalse(indexed); self.assertFalse(roots)
        self.assertEqual(1, issues['duplicate_session'])

    def test_bad_header_is_not_echoed(self):
        (self.sessions/'bad.jsonl').write_text(SECRET)
        _, _, issues = bundle.discover(self.project, self.sessions)
        self.assertIn('header_unreadable', issues)
        self.assertNotIn(SECRET, str(issues))

    def test_symlink_tree_is_not_traversed(self):
        external = self.base/'outside'; external.mkdir()
        (external/'root.jsonl').write_text(json.dumps(rows(self.project)[0]))
        (self.sessions/'linked').symlink_to(external, target_is_directory=True)
        _, roots, issues = bundle.discover(self.project, self.sessions)
        self.assertFalse(roots); self.assertIn('symlink_skipped', issues)

    def test_index_limit_is_explicit(self):
        self.log(rows(self.project, 'a'), 'a.jsonl'); self.log(rows(self.project, 'b'), 'b.jsonl')
        with patch.object(bundle, 'MAX_FILES', 1):
            _, _, issues = bundle.discover(self.project, self.sessions)
        self.assertEqual(1, issues['file_index_limit'])

    def test_archive_has_no_path_traversal(self):
        with zipfile.ZipFile(self.empty_bundle()['bundle']) as archive:
            self.assertTrue(all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in archive.namelist()))

    def test_no_network_subprocess_or_model_dependencies(self):
        tree = ast.parse(SCRIPT.read_text())
        names = {node.names[0].name.split('.')[0] for node in ast.walk(tree) if isinstance(node, ast.Import)}
        names |= {node.module.split('.')[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module}
        self.assertTrue(names.isdisjoint({'socket','subprocess','requests','httpx','urllib','openai'}))

    def test_global_poll_rule_and_compact_guidance(self):
        rules = (ROOT/'AGENTS.md').read_text()
        self.assertIn('30 分钟', rules)
        self.assertIn('完成', rules)
        self.assertLessEqual(len(rules), 3200)


class BundleIntegrationTests(unittest.TestCase):
    setUp = BundleSafetyTests.setUp
    log = BundleSafetyTests.log

    def gather(self, **kwargs):
        return bundle.collect_recent(self.project, self.home, self.sessions, ROOT, now=NOW, **kwargs)

    def test_actual_observer_zero_network_and_private_archive(self):
        self.log(rows(self.project, turns=2))
        before = {str(p): p.read_bytes() for p in self.sessions.rglob('*.jsonl')}
        with patch.object(socket, 'create_connection', side_effect=AssertionError('network')), \
             patch.object(subprocess, 'Popen', side_effect=AssertionError('subprocess')):
            runs, inventory, selection, engine = self.gather()
            result = bundle.write_bundle(self.project,self.home,runs,inventory,selection,engine,now=NOW)
        self.assertEqual(2, len(runs))
        self.assertTrue(all(r['expectation']['mode'] == 'unknown' for r in runs))
        self.assertTrue(all(r['metrics']['diagnostic_model_calls'] == 0 for r in runs))
        with zipfile.ZipFile(result['bundle']) as archive:
            raw = b'\n'.join(archive.read(name) for name in archive.namelist())
            self.assertNotIn(SECRET.encode(), raw)
            self.assertNotIn(str(self.project).encode(), raw)
            self.assertIn('reports/001.md', archive.namelist())
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.sessions.rglob('*.jsonl')})

    def test_only_latest_turns_selected_with_limit_disclosed(self):
        self.log(rows(self.project, turns=4))
        runs, _, selection, _ = self.gather(limit=2)
        self.assertEqual(['t3','t2'], [r['turn'] for r in runs])
        self.assertEqual(2, selection['omitted_older_slices'])
        self.assertEqual(4, selection['eligible_slices'])

    def test_explicit_expectation_passed_without_inference(self):
        self.log(rows(self.project))
        runs, _, _, _ = self.gather(expected_mode='sdd', expected_roles=['explorer'])
        self.assertEqual('sdd', runs[0]['expectation']['mode'])
        self.assertEqual(['explorer'], runs[0]['expectation']['roles'])

    def test_linked_child_included_not_other_project(self):
        root = rows(self.project)
        root.insert(-1, envelope('response_item', {'type':'function_call','call_id':'spawn',
                    'name':'spawn_agent','namespace':'agents',
                    'arguments':json.dumps({'agent_type':'explorer','fork_turns':'none'})},1))
        root.insert(-1, envelope('response_item', {'type':'function_call_output','call_id':'spawn',
                    'output':json.dumps({'agent_id':'child'})},1))
        self.log(root)
        self.log(rows(self.project, 'child', 'explorer', 'root'), 'child.jsonl')
        self.log(rows(self.base/'other', 'other'), 'other.jsonl')
        runs, _, _, _ = self.gather()
        self.assertEqual({'root','child'}, {s['id'] for s in runs[0]['sessions']})

    def test_main_one_call_prints_only_result(self):
        self.log(rows(self.project))
        output = io.StringIO()
        with patch.dict(os.environ, {'CODEX_HOME': str(self.home)}), redirect_stdout(output):
            code = bundle.main(['--root',str(self.project),'--days','90'])
        self.assertEqual(0, code)
        data = json.loads(output.getvalue())
        self.assertTrue(Path(data['bundle']).is_file())
        self.assertEqual(0, data['diagnostic_model_calls'])
        self.assertNotIn(SECRET, output.getvalue())

    def test_installer_ships_skill_engine_and_metadata(self):
        sys_path = __import__('sys').path
        sys_path.insert(0,str(ROOT/'scripts'))
        import install
        home = self.base/'installed'
        install.install(ROOT,home,validate=False)
        for path in ('sdd-diagnose/SKILL.md','sdd-diagnose/agents/openai.yaml',
                     'sdd-diagnose/scripts/bundle.py','sdd-do/scripts/observation/collect.py'):
            self.assertTrue((home/'skills'/path).is_file())
        module_spec=importlib.util.spec_from_file_location('installed_bundle',home/'skills/sdd-diagnose/scripts/bundle.py')
        installed=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(installed)
        self.assertEqual(home/'skills/sdd-do/scripts', installed.load_engine().scripts)
        self.assertIn('sdd-diagnose', install.SKILLS)
        self.assertIn('30 分钟',(home/'AGENTS.md').read_text())


if __name__ == '__main__':
    unittest.main()
