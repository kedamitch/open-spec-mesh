"""Offline decisions, safety, actual HTTP batch contract and complete install on/off tests."""
from __future__ import annotations

import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import tomllib

from test_install import installer, snapshot
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'mcp'))
import laya_contracts as C
import laya_runtime as R

ENV = {'LAYA_BASE_URL': 'http://127.0.0.1:9876', 'LAYA_API_KEY': 'test-not-secret',
       'LAYA_MODEL': 'multilingual',
       'CONTEXT7_API_KEY': 'test-context', 'TAVILY_API_KEY': 'test-tavily'}
JEV_ENV = {'SYSTEMONE_PROVIDER': 'jev', 'TYPESAFE_API_KEY': 'test-jev-secret',
           'TYPESAFE_BASE_URL': 'http://127.0.0.1:9876', 'TYPESAFE_DEFAULT_MODEL': 'jev-latest'}
MODE = C.load_template('execution-mode@1')
DELEGATE = C.load_template('delegation@1')


def answer(questions, choices=None):
    choices = choices or {}
    result = {}
    for name, q in questions.items():
        kind = q['type']
        value = choices.get(name, next(iter(q['criteria'])) if kind == 'choice' else .6)
        result[name] = {'type': kind, kind: value}
    return {'answers': result}


def items(n=2):
    return [{'id': f'job-{i}', 'state': {'request': f'Task {i}'}} for i in range(n)]


class DecisionsTest(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, ENV, clear=True); env.start(); self.addCleanup(env.stop)
        self.calls = []
        def transport(method, path, body=None):
            self.calls.append((method, path, body))
            if path == '/health':
                return {'status': 'ok', 'loaded': ['multilingual']}
            self.assertEqual(('POST', '/v1/systemone/batch'), (method, path))
            self.assertEqual({'requests'}, set(body))
            return {'results': [answer(r['questions']) for r in body['requests']]}
        self.runtime = R.Runtime(transport)

    def test_templates_and_no_arbitrary_paths(self):
        self.assertEqual({'execution-mode@1', 'delegation@1'}, {v['id'] for v in C.list_templates()})
        for value in ('../evil@1', 'missing@1', 'execution-mode@0', {}, ''):
            with self.subTest(value=value), self.assertRaises((ValueError, OSError)):
                C.load_template(value)

    def test_quick_is_default_and_investigation_does_not_upgrade_mode(self):
        q = MODE['questions']['mode']
        self.assertIn('Quick 为默认', q['instructions'])
        self.assertIn('Explorer / Librarian', q['instructions'])
        self.assertIn('Main 可连续完成', q['criteria']['quick'])
        self.assertIn('Architect', q['criteria']['sdd'])
        self.assertNotIn('simple', q['criteria'])
        self.assertNotIn('complex_candidate', q['criteria'])

    def test_real_batch_not_sequential_loop(self):
        out = self.runtime.run('execution-mode@1', items(3))
        self.assertEqual('ok', out['status'])
        self.assertEqual(1, len(self.calls))
        self.assertEqual('/v1/systemone/batch', self.calls[0][1])
        self.assertEqual(3, len(self.calls[0][2]['requests']))
        self.assertEqual(['job-0', 'job-1', 'job-2'], [r['id'] for r in out['results']])
        self.assertEqual('server_batch', out['metrics']['backend'])

    def test_single_request_uses_batch_and_default_multilingual(self):
        os.environ.pop('LAYA_MODEL')
        out = self.runtime.run('execution-mode@1', items(1))
        self.assertEqual('ok', out['status'])
        self.assertEqual('/v1/systemone/batch', self.calls[0][1])
        self.assertEqual(1, len(self.calls))
        self.assertEqual(1, len(self.calls[0][2]['requests']))
        self.assertEqual('multilingual', self.calls[0][2]['requests'][0]['model'])
        self.assertEqual('job-0', out['results'][0]['id'])
        self.assertEqual('server_batch', out['metrics']['backend'])

    def test_native_raw_list_batch_response_is_accepted(self):
        def raw_list_transport(method, path, body=None):
            self.assertEqual(('POST', '/v1/systemone/batch'), (method, path))
            return [answer(r['questions']) for r in body['requests']]

        runtime = R.Runtime(raw_list_transport)
        named = runtime.run('execution-mode@1', items(2))
        self.assertEqual('ok', named['status'])
        self.assertEqual(['model', 'model'], [r['basis'] for r in named['results']])
        self.assertEqual('server_batch', named['metrics']['backend'])

        raw = runtime.predict({'request': 'prototype'}, MODE['questions'])
        self.assertEqual(answer(MODE['questions'])['answers'], raw['answers'])

    def test_jev_provider_uses_official_single_systemone_endpoint(self):
        calls = []
        def transport(method, path, body=None):
            calls.append((method, path, body))
            self.assertEqual(('POST', '/v1/systemone'), (method, path))
            self.assertEqual('jev-latest', body['model'])
            return answer(body['questions'])

        with patch.dict(os.environ, JEV_ENV, clear=True):
            runtime = R.Runtime(transport)
            out = runtime.run('execution-mode@1', items(2))
            self.assertEqual('ok', out['status'])
            self.assertEqual('jev_systemone', out['metrics']['backend'])
            self.assertEqual(2, out['metrics']['network_calls'])
            self.assertEqual(['/v1/systemone', '/v1/systemone'], [call[1] for call in calls])
            raw = runtime.predict({'request':'prototype'}, MODE['questions'])
            self.assertEqual(answer(MODE['questions'])['answers'], raw['answers'])
            self.assertEqual('/v1/systemone', calls[-1][1])

    def test_retired_batch_variable_is_ignored_and_not_forwarded(self):
        self.assertNotIn('LAYA_BATCH_PATH', C.OPTIONAL_ENV)
        expected = C.config()
        for path in ('', '/custom', 'https://untrusted.invalid/?token=secret'):
            with self.subTest(path=path), patch.dict(os.environ, {'LAYA_BATCH_PATH': path}):
                self.assertEqual(expected, C.config())
                self.assertNotIn('LAYA_BATCH_PATH', installer.research_install_env())
                self.assertEqual('ok', self.runtime.run('execution-mode@1', items())['status'])
        self.assertEqual(['/v1/systemone/batch'] * 3, [c[1] for c in self.calls])

    def test_same_batch_duplicates_inferred_once(self):
        data = items(); data[1]['state'] = data[0]['state']
        out = self.runtime.run('execution-mode@1', data)
        self.assertEqual(1, len(self.calls))
        self.assertEqual('/v1/systemone/batch', self.calls[0][1])
        self.assertEqual(1, len(self.calls[0][2]['requests']))
        self.assertEqual(['job-0', 'job-1'], [r['id'] for r in out['results']])
        self.assertEqual('server_batch', out['metrics']['backend'])

    def test_prototype_uses_batch_preserving_typed_answers(self):
        questions = {
            'kind': {'type':'choice', 'instructions':'Classify', 'criteria':['one','two']},
            'score': {'type':'score', 'instructions':'Rate', 'criteria':['low','high']},
            'yes': {'type':'noul', 'instructions':'Is it relevant?'},
        }
        out = self.runtime.predict({'request':'test'}, questions, model='english')
        self.assertEqual({'answers', 'advisory'}, set(out))
        self.assertEqual(answer(questions)['answers'], out['answers'])
        self.assertEqual(1, len(self.calls))
        self.assertEqual('/v1/systemone/batch', self.calls[0][1])
        self.assertEqual('english', self.calls[0][2]['requests'][0]['model'])

    def test_bad_batch_envelope_falls_back_for_single_and_raw(self):
        a = answer(MODE['questions'])
        for body in ([], {}, a, {'results':None}, {'results':{}}, {'results':[]}, {'results':[a,a]}):
            for raw in (False, True):
                with self.subTest(body=body, raw=raw):
                    runtime = R.Runtime(lambda *args: body)
                    out = (runtime.predict({'request':'test'}, MODE['questions']) if raw else
                           runtime.run('execution-mode@1', items(1)))
                    row = out if raw else out['results'][0]
                    self.assertEqual('batch_alignment_error', row['reason'])
                    self.assertEqual('fallback', out['status'])

    def test_batch_unavailable_never_retries_legacy_endpoint(self):
        for raw in (False, True):
            with self.subTest(raw=raw):
                calls = []
                def unavailable(*args):
                    calls.append(args)
                    raise R.ServiceError('http_404')
                runtime = R.Runtime(unavailable)
                out = (runtime.predict({'request':'test'}, MODE['questions']) if raw else
                       runtime.run('execution-mode@1', items(1)))
                row = out if raw else out['results'][0]
                self.assertEqual('http_404', row['reason'])
                self.assertEqual('circuit_open', runtime.predict({}, MODE['questions'])['reason'])
                self.assertEqual(1, len(calls))
                self.assertEqual('/v1/systemone/batch', calls[0][1])

    def test_cached_and_rule_rows_leave_one_batch_item(self):
        os.environ['LAYA_MODEL_REVISION'] = 'pinned'
        self.runtime.run('execution-mode@1', items(1))
        self.calls.clear()
        data = items(3)
        data[2]['state']['existing_mode'] = 'sdd'
        out = self.runtime.run('execution-mode@1', data)
        self.assertEqual('ok', out['status'])
        self.assertEqual(1, len(self.calls))
        self.assertEqual('/v1/systemone/batch', self.calls[0][1])
        self.assertEqual(1, len(self.calls[0][2]['requests']))
        self.assertEqual(['cache','model','existing_state'], [r['basis'] for r in out['results']])

    def test_cache_requires_pinned_revision(self):
        self.runtime.run('execution-mode@1', items(1)); self.runtime.run('execution-mode@1', items(1))
        self.assertEqual(2, len(self.calls))
        os.environ['LAYA_MODEL_REVISION'] = 'fixed-snapshot-1'
        self.runtime.run('execution-mode@1', items(1))
        out = self.runtime.run('execution-mode@1', items(1))
        self.assertEqual(3, len(self.calls)); self.assertEqual(1, out['metrics']['cache_hits'])
        os.environ['LAYA_MODEL_REVISION'] = 'fixed-snapshot-2'
        self.runtime.run('execution-mode@1', items(1)); self.assertEqual(4, len(self.calls))
        os.environ['LAYA_API_KEY'] = 'another-scope'
        self.runtime.run('execution-mode@1', items(1)); self.assertEqual(5, len(self.calls))

    def test_cache_ttl_state_schema_and_model_invalidation(self):
        os.environ['LAYA_MODEL_REVISION'] = 'r1'
        now = [100.]; self.runtime.clock = lambda: now[0]
        self.runtime.run('execution-mode@1', items(1))
        now[0] += 61
        self.runtime.run('execution-mode@1', items(1))
        self.runtime.run('execution-mode@1', items(1), context={'facts':'changed'})
        self.runtime.run('execution-mode@1', items(1), model='english')
        t = copy.deepcopy(MODE); t['digest'] = 'different'
        with patch.object(R, 'load_template', return_value=t):
            self.runtime.run('execution-mode@1', items(1))
        self.assertEqual(5, len(self.calls))

    def test_existing_mode_and_leaf_role_use_rules(self):
        out = self.runtime.run('execution-mode@1', items(1), {'existing_mode': 'sdd'})
        self.assertEqual('sdd', out['results'][0]['recommendation']['mode'])
        out = self.runtime.run('delegation@1', items(1), {'current_role':'worker','available_roles':['explorer']})
        self.assertEqual({'executor':'worker'}, out['results'][0]['recommendation'])
        self.assertEqual([], self.calls)

    def test_mode_and_role_enums_normalize_case_and_whitespace(self):
        out = self.runtime.run('execution-mode@1', items(1), {'existing_mode': ' SDD '})
        self.assertEqual('sdd', out['results'][0]['recommendation']['mode'])
        self.assertEqual('existing_state', out['results'][0]['basis'])
        self.assertEqual([], self.calls)

        out = self.runtime.run('delegation@1', items(1), {
            'current_role': ' Main ',
            'available_roles': [' Explorer ', 'LIBRARIAN', 'Worker', ' reviewer '],
        })
        self.assertEqual('ok', out['status'])
        sent = self.calls[-1][2]['requests'][0]['state']
        self.assertEqual('main', sent['current_role'])
        self.assertEqual(['explorer', 'librarian'], sent['available_roles'])
        self.assertEqual('quick', sent['execution_mode'])

        for bad in ('unknown', ' administrator '):
            with self.subTest(role=bad):
                before = len(self.calls)
                failed = self.runtime.run('delegation@1', items(1), {
                    'current_role': bad,
                    'available_roles': ['explorer'],
                })
                self.assertEqual('fallback', failed['status'])
                self.assertEqual(before, len(self.calls))

    def test_delegation_biases_unknown_facts_to_investigation_roles(self):
        out = self.runtime.run('delegation@1', items(1), {
            'current_role': 'main',
            'available_roles': ['explorer', 'librarian', 'worker'],
        })
        self.assertEqual('ok', out['status'])
        executor = self.calls[-1][2]['requests'][0]['questions']['executor']
        self.assertIn('本地实现', executor['criteria']['explorer'])
        self.assertIn('外部文档', executor['criteria']['librarian'])
        self.assertIn('流程控制、派发、集成和验收', executor['criteria']['main'])

    def test_delegation_executor_choice_uses_actual_descriptions_and_filters_candidates(self):
        out = self.runtime.run('delegation@1', items(1), {
            'current_role': 'Main',
            'available_roles': ['explorer', 'reviewer', 'architect', 'explorer'],
        })
        self.assertEqual('ok', out['status'])
        request = self.calls[-1][2]['requests'][0]
        sent = request['state']
        self.assertEqual(['explorer'], sent['available_roles'])
        self.assertNotIn('role_descriptions', sent)
        self.assertEqual({'executor'}, set(request['questions']))
        executor = request['questions']['executor']
        self.assertEqual({'main', 'explorer', 'uncertain'}, set(executor['criteria']))
        self.assertIn('流程控制、派发、集成和验收', executor['criteria']['main'])
        self.assertIn('已有足够事实', executor['criteria']['main'])
        self.assertIn('只在当前角色和 state.available_roles 中选择', executor['instructions'])
        self.assertNotIn('task_graph_ready', executor['instructions'])
        self.assertNotIn('Reviewer', executor['instructions'])
        self.assertIn('优先 Explorer', executor['instructions'])
        self.assertNotIn('Librarian', executor['instructions'])
        for role in ('explorer',):
            data = tomllib.loads((ROOT/f'agents/{role}.toml').read_text())
            self.assertEqual(data['description'], executor['criteria'][role])
        self.assertNotIn('worker', executor['criteria'])
        self.assertNotIn('architect', executor['criteria'])

    def test_mode_permission_matrix_filters_delegation(self):
        base = {'current_role':'main',
                'available_roles':['architect','worker','reviewer','explorer','librarian']}

        quick = C.prepare_state(DELEGATE, {**base, 'request':'q', 'execution_mode':'quick'})
        self.assertEqual(['explorer','librarian'], quick['available_roles'])

        planning = C.prepare_state(DELEGATE, {**base, 'request':'s', 'execution_mode':'sdd'})
        self.assertEqual(['architect','explorer','librarian'], planning['available_roles'])

        ready = C.prepare_state(DELEGATE, {
            **base, 'request':'s', 'execution_mode':'sdd', 'task_graph_ready':True})
        self.assertEqual(['architect','worker','explorer','librarian'],
                         ready['available_roles'])

        reviewed = C.prepare_state(DELEGATE, {
            **base, 'request':'s', 'execution_mode':'sdd', 'task_graph_ready':True,
            'reviewer_requested':True})
        self.assertEqual(['architect','worker','reviewer','explorer','librarian'],
                         reviewed['available_roles'])

        not_boolean = C.prepare_state(DELEGATE, {
            **base, 'request':'s', 'execution_mode':'sdd', 'task_graph_ready':True,
            'reviewer_requested':'true'})
        self.assertNotIn('reviewer', not_boolean['available_roles'])

    def test_architect_only_sees_its_own_delegate_candidates(self):
        out = self.runtime.run('delegation@1', items(1), {
            'current_role': 'architect',
            'execution_mode': 'sdd',
            'available_roles': ['worker', 'reviewer', 'explorer', 'librarian'],
        })
        self.assertEqual('ok', out['status'])
        request = self.calls[-1][2]['requests'][0]
        self.assertEqual(['explorer', 'librarian'], request['state']['available_roles'])
        self.assertEqual({'architect', 'explorer', 'librarian', 'uncertain'},
                         set(request['questions']['executor']['criteria']))
        self.assertNotIn('worker', request['questions']['executor']['criteria'])
        self.assertNotIn('reviewer', request['questions']['executor']['criteria'])

    def test_executor_guard_accepts_current_or_permitted_role_only(self):
        state = {'current_role':'main', 'available_roles':['explorer']}
        self.assertEqual({'executor':'main'}, C.guard(DELEGATE, state, {
            'executor': {'type':'choice','choice':'main'}}))
        self.assertEqual({'executor':'explorer'}, C.guard(DELEGATE, state, {
            'executor': {'type':'choice','choice':'explorer'}}))
        self.assertIsNone(C.guard(DELEGATE, state, {
            'executor': {'type':'choice','choice':'reviewer'}}))
        self.assertIsNone(C.guard(DELEGATE, state, {
            'executor': {'type':'choice','choice':'uncertain'}}))

    def test_sdd_role_order_and_available_roles_do_not_expand_permissions(self):
        state = {'current_role':'main','available_roles':['architect'],'execution_mode':'quick'}
        self.assertIsNone(C.guard(DELEGATE,state, {
            'executor': {'type':'choice','choice':'architect'}}))
        state.update({'execution_mode':'sdd'})
        self.assertEqual({'executor':'architect'}, C.guard(DELEGATE,state, {
            'executor': {'type':'choice','choice':'architect'}}))
        state = {'current_role':'main','available_roles':['worker'],'execution_mode':'sdd'}
        self.assertIsNone(C.guard(DELEGATE,state, {
            'executor': {'type':'choice','choice':'worker'}}))
        state['task_graph_ready'] = True
        self.assertEqual({'executor':'worker'}, C.guard(DELEGATE,state, {
            'executor': {'type':'choice','choice':'worker'}}))
        state = {'current_role':'architect','available_roles':['worker'],
                 'execution_mode':'sdd'}
        self.assertIsNone(C.guard(DELEGATE,state, {
            'executor': {'type':'choice','choice':'worker'}}))

    def test_corrupt_rows_and_uncertain_are_not_cached_or_applied(self):
        def transport(*args):
            return {'results':[answer(MODE['questions']), {'answers':{'mode':{'type':'choice','choice':'evil'}}}]}
        self.runtime.transport = transport
        out = self.runtime.run('execution-mode@1', items())
        self.assertEqual('partial', out['status']); self.assertEqual('fallback',out['results'][1]['status'])
        self.runtime.transport = lambda *args: {'results':[answer(MODE['questions'],{'mode':'uncertain'})]}
        out = self.runtime.run('execution-mode@1',items(1)); self.assertEqual('fallback',out['status'])

    def test_alignment_mismatch_fails_all_unmatched_not_reordered(self):
        self.runtime.transport = lambda *args: {'results':[]}
        out = self.runtime.run('execution-mode@1', items())
        self.assertEqual('fallback',out['status'])
        self.assertTrue(all(r['reason']=='batch_alignment_error' for r in out['results']))

    def test_outage_circuit_spans_named_and_raw_calls(self):
        def broken(*args):
            self.calls.append(args); raise R.ServiceError('http_503')
        self.runtime.transport = broken
        self.runtime.run('execution-mode@1', items(1))
        self.runtime.run('execution-mode@1', items(1))
        self.runtime.predict({'request':'x'}, MODE['questions'])
        self.assertEqual(1,len(self.calls))
        self.runtime.transport = lambda *args: {'status':'ok','loaded':[]}
        self.assertEqual('ok',self.runtime.status()['status'])
        self.runtime.transport = broken
        self.runtime.run('execution-mode@1',items(1)); self.assertEqual(2,len(self.calls))

    def test_disabled_checks_no_config_or_http(self):
        with patch.object(R,'enabled',return_value=False), patch.object(R,'provider_config') as cfg:
            self.assertEqual('disabled',self.runtime.status()['status'])
            self.assertEqual('disabled',self.runtime.run('execution-mode@1',items())['reason'])
            self.assertEqual('disabled',self.runtime.predict({},MODE['questions'])['reason'])
        cfg.assert_not_called(); self.assertEqual([],self.calls)

    def test_bad_input_fails_before_http(self):
        for data in ([],items(17),[{'id':'x','state':{}}], items(1)*2,
                     [{'id':'x','state':{'request':'x'*4097}}]):
            self.assertEqual('fallback',self.runtime.run('execution-mode@1',data)['status'])
        self.assertEqual([],self.calls)

    def test_valid_custom_template_no_code_or_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ['LAYA_TEMPLATE_DIR']=tmp
            template={'id':'repeat-kind@1','description':'test','required_fields':['failure'],
                      'questions':{'kind':{'type':'choice','instructions':'Classify','criteria':['one','uncertain']}}}
            path=Path(tmp)/'repeat-kind.v1.json'; path.write_bytes(C.encode(template))
            out=self.runtime.run('repeat-kind@1',[{'id':'1','state':{'failure':'test'}}])
            self.assertEqual('one',out['results'][0]['recommendation']['kind'])
            path.unlink(); path.symlink_to(ROOT/'mcp/templates/execution-mode.v1.json')
            self.assertEqual('fallback',self.runtime.run('repeat-kind@1',items(1))['status'])

    def test_invalid_urls_and_keys_are_redacted(self):
        for url in ('http://u:secret@example.com','http://localhost:bad','file:///tmp/a','https://x/?key=secret','http://x/#fragment','http://x/\nheader'):
            with patch.dict(os.environ, {'LAYA_BASE_URL':url}):
                with self.assertRaises(ValueError) as error:C.config()
                self.assertNotIn('secret',str(error.exception))

    def test_metrics_never_contain_state_ids_or_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'events.jsonl'; os.environ['LAYA_METRICS_PATH']=str(target)
            out=self.runtime.run('execution-mode@1',[{'id':'sensitive-ID','state':{'request':'private text'}}])
            self.assertTrue(out['metrics_written']); text=target.read_text()
            for secret in ('sensitive-ID','private text',ENV['LAYA_API_KEY']):self.assertNotIn(secret,text)
            self.assertEqual(0o600,target.stat().st_mode&0o777)
            event=json.loads(text);self.assertEqual(1,event['count']);self.assertEqual(1,event['network_calls'])

    def test_metrics_failure_nonblocking(self):
        os.environ['LAYA_METRICS_PATH']='relative.jsonl'
        out=self.runtime.run('execution-mode@1',items(1))
        self.assertEqual('ok',out['status']);self.assertFalse(out['metrics_written'])


class SwitchTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=Path(self.tmp.name)/'home'
        env=patch.dict(os.environ,{},clear=True);env.start();self.addCleanup(env.stop)

    def install(self, on=True, **kwargs):
        return installer.install(ROOT,self.home,validate=False,with_laya=on,**kwargs)

    def test_enabled_disabled_reenabled_preserves_user_files(self):
        self.home.mkdir(); skill=self.home/'skills/typesafe-ai';skill.mkdir(parents=True)
        (skill/'SKILL.md').write_text('original user TypeSafe skill')
        custom=self.home/'mcp/custom.py';custom.parent.mkdir();custom.write_text('keep')
        self.install();on=snapshot(self.home)
        self.assertTrue((self.home/'skills/typesafe-laya/SKILL.md').is_file())
        self.install(False)
        cfg=tomllib.loads((self.home/'config.toml').read_text())
        self.assertFalse(cfg['mcp_servers']['laya']['enabled'])
        self.assertFalse((self.home/'skills/typesafe-laya').exists())
        self.assertFalse(json.loads((self.home/'mcp/laya-settings.json').read_text())['enabled'])
        self.assertNotIn('Laya',(self.home/'AGENTS.md').read_text())
        self.assertNotIn('typesafe-laya',(self.home/'index.md').read_text())
        for role in installer.ROLES:
            self.assertEqual((ROOT/f'agents/{role}.toml').read_bytes(),(self.home/f'agents/{role}.toml').read_bytes())
        self.assertEqual('keep',custom.read_text());self.assertEqual('original user TypeSafe skill',(skill/'SKILL.md').read_text())
        self.install(); after=snapshot(self.home)
        self.assertEqual(tomllib.loads(on['config.toml'][0].decode()), tomllib.loads(after['config.toml'][0].decode()))
        self.assertEqual({k:v for k,v in on.items() if k != 'config.toml'}, {k:v for k,v in after.items() if k != 'config.toml'})
        self.install(); self.assertEqual(after,snapshot(self.home))

    def test_off_does_not_check_laya_or_install_dependencies(self):
        with patch.object(installer,'check_laya_env') as check,patch.object(installer,'ensure_laya_mcp') as pip, \
             patch.object(installer,'check_research_keys'),patch.object(installer,'ensure_research_tools',return_value={}):
            self.install(False,install_tools=True)
        check.assert_not_called();pip.assert_not_called()
        self.assertFalse((self.home/installer.TOOLS_DIR).exists())

    def test_cli_defaults_off_and_requires_explicit_with_laya(self):
        args=[sys.executable,str(ROOT/'scripts/install.py'),'--codex-home',str(self.home),'--skip-tools']
        result=subprocess.run(args,text=True,capture_output=True)
        self.assertEqual(0,result.returncode,result.stderr)
        self.assertNotIn('ENV LAYA_',result.stdout)
        self.assertNotIn('ENV TYPESAFE_',result.stdout)
        self.assertFalse((self.home/'skills/typesafe-laya').exists())
        cfg=tomllib.loads((self.home/'config.toml').read_text())
        self.assertNotIn('laya',cfg.get('mcp_servers',{}))

        result=subprocess.run(args+['--with-laya'],text=True,capture_output=True)
        self.assertEqual(0,result.returncode,result.stderr)
        self.assertIn('ENV LAYA_BASE_URL',result.stdout)
        self.assertTrue((self.home/'skills/typesafe-laya/SKILL.md').exists())
        self.assertTrue(tomllib.loads((self.home/'config.toml').read_text())['mcp_servers']['laya']['enabled'])

    def test_dryrun_off_unchanged_and_failed_off_rolls_back(self):
        self.install(); before=snapshot(self.home); self.install(False,dry_run=True)
        self.assertEqual(before,snapshot(self.home)); original=installer.os.replace
        def fail(src,dst):
            if Path(dst)==self.home/'config.toml' and Path(src).name.startswith('.config.toml.'):raise OSError('injected')
            return original(src,dst)
        with patch.object(installer.os,'replace',side_effect=fail),self.assertRaises(OSError):self.install(False)
        self.assertEqual(before,snapshot(self.home))

    def test_custom_mcp_off_preserves_endpoint_and_auth(self):
        self.home.mkdir();(self.home/'config.toml').write_text('[mcp_servers.laya]\nurl="https://example.test/mcp"\nbearer_token_env_var="CUSTOM_KEY"\n')
        self.install(False)
        v=tomllib.loads((self.home/'config.toml').read_text())['mcp_servers']['laya']
        self.assertEqual({'url':'https://example.test/mcp','bearer_token_env_var':'CUSTOM_KEY','enabled':False},v)
        self.install();self.assertEqual(v,tomllib.loads((self.home/'config.toml').read_text())['mcp_servers']['laya'])

    def test_unmanaged_same_named_skill_not_destroyed(self):
        p=self.home/'skills/typesafe-laya';p.mkdir(parents=True);(p/'SKILL.md').write_text('mine')
        with self.assertRaises(ValueError):self.install()
        self.assertEqual('mine',(p/'SKILL.md').read_text())

    def test_original_typesafe_symlink_is_untouched(self):
        p=Path(self.tmp.name)/'original';p.mkdir();(p/'SKILL.md').write_text('mine')
        skills=self.home/'skills';skills.mkdir(parents=True);(skills/'typesafe-ai').symlink_to(p,target_is_directory=True)
        self.install();self.install(False)
        self.assertTrue((skills/'typesafe-ai').is_symlink());self.assertEqual('mine',(p/'SKILL.md').read_text())

    def test_live_old_process_disabled_without_http(self):
        self.install(False)
        script=self.home/'mcp/laya_http_mcp.py'
        request=Path(self.tmp.name)/'input.json'; request.write_text(json.dumps({'decision':'execution-mode@1','items':items(1)}))
        result=subprocess.run([sys.executable,str(script),'--input',str(request)],capture_output=True,text=True)
        self.assertEqual('disabled',json.loads(result.stdout)['reason'])

    def test_forwarding_preserves_existing_extra_environment(self):
        self.install()
        cfg=self.home/'config.toml';s=cfg.read_text().replace('"LAYA_BASE_URL",','"EXTRA", "LAYA_BASE_URL",')
        cfg.write_text(s);self.install()
        self.assertIn('EXTRA',tomllib.loads(cfg.read_text())['mcp_servers']['laya']['env_vars'])


    def test_upgrade_removes_retired_env_without_changing_other_settings(self):
        for on in (True, False):
            with self.subTest(on=on):
                self.install()
                path = self.home/'config.toml'
                data = tomllib.loads(path.read_text())['mcp_servers']['laya']
                data['env_vars'] += ['EXTRA', 'LAYA_BATCH_PATH',
                                     {'name':'LAYA_BATCH_PATH','source':'remote'},
                                     {'name':'OTHER','source':'remote'}]
                data['env'] = {'LAYA_BATCH_PATH':'/old', 'KEEP':'unchanged'}
                data['startup_timeout_sec'] = 45
                text = installer.set_value(path.read_text(), ('mcp_servers','laya'), data)
                path.write_text(text)
                before = snapshot(self.home)
                self.install(on, dry_run=True)
                self.assertEqual(before, snapshot(self.home))
                self.install(on)
                result = tomllib.loads(path.read_text())['mcp_servers']['laya']
                self.assertNotIn('LAYA_BATCH_PATH', json.dumps(result))
                self.assertIn('EXTRA', result['env_vars'])
                self.assertIn({'name':'OTHER','source':'remote'}, result['env_vars'])
                self.assertEqual({'KEEP':'unchanged'}, result['env'])
                self.assertEqual(45, result['startup_timeout_sec'])
                self.assertEqual(on, result['enabled'])
                after = snapshot(self.home)
                self.install(on)
                self.assertEqual(after, snapshot(self.home))

    def test_custom_laya_keeps_its_own_environment(self):
        self.home.mkdir()
        path = self.home/'config.toml'
        path.write_text('[mcp_servers.laya]\ncommand="/custom/bridge"\n'
                        'env_vars=["LAYA_BATCH_PATH"]\n'
                        '[mcp_servers.laya.env]\nLAYA_BATCH_PATH="/custom"\n')
        before = tomllib.loads(path.read_text())['mcp_servers']['laya']
        self.install()
        self.assertEqual(before, tomllib.loads(path.read_text())['mcp_servers']['laya'])


if __name__=='__main__':unittest.main()
