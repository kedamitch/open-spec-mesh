"""Offline behavior diagnostics: deterministic evidence, privacy, scope, and zero model calls."""
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'sdd-do/scripts'))
from observation.trace import read_rollout, command_fact, output_status, digest
from observation.collect import collect, snapshot, select
from observation.diagnose import diagnose, markdown, summary
from observation.store import open_store, save, load, all_runs

RULES = '''# 工作约定
| Agent | 调用时机 |
| --- | --- |
| Explorer / Librarian | 已批准 Complex 中需要独立的本地 / 外部证据调查 |
'''
SECRET = 'sk-DO-NOT-PERSIST-SECRET-OR-RAW-CONTENT'


def envelope(typ, payload, second=0):
    return {'type': typ, 'timestamp': f'2026-09-23T10:00:{second:02d}Z', 'payload': payload}


def log_rows(sid='root', parent=None, role=None, turn='t1'):
    return [envelope('session_meta', {'id': sid, 'parent_thread_id': parent, 'agent_role': role, 'cli_version': '0.155.1', 'base_instructions': SECRET}),
            envelope('event_msg', {'type': 'task_started', 'turn_id': turn}, 1),
            envelope('turn_context', {'turn_id': turn, 'model': 'gpt-6-luna', 'effort': 'max'}, 2)]


def tool(call_id, name, args, second=3):
    return envelope('response_item', {'type': 'function_call', 'call_id': call_id, 'name': name, 'namespace': 'agents',
                                      'arguments': json.dumps(args)}, second)


def output(call_id, data, second=4):
    return envelope('response_item', {'type': 'function_call_output', 'call_id': call_id, 'output': json.dumps(data)}, second)


def end(second=50):
    return envelope('event_msg', {'type': 'task_complete'}, second)


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.project = self.base/'project'; self.project.mkdir()
        self.rules = self.base/'rules'; self.rules.mkdir()
        (self.rules/'AGENTS.md').write_text(RULES)
        self.sessions = self.base/'sessions'; self.sessions.mkdir()
        self.dbpath = self.base/'observations.sqlite3'

    def write(self, rows=None, name='root.jsonl'):
        file = self.sessions/name
        file.write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in (rows or log_rows()+[end()])))
        return file

    def run_analysis(self, rows=None, expected='sdd', roles=('explorer',), **kw):
        return diagnose(collect(self.project, self.rules, self.write(rows), self.sessions,
                                expected_mode=expected, expected_roles=roles, **kw))

    def rules_found(self, run):
        return {f['rule'] for f in run['findings']}

    def make_change(self, history=None):
        name = 'CHG-20260923-example'
        path = self.project/'docs/05-changes/C02-已完成'/name
        tasks = path/'C03-tasks'
        tasks.mkdir(parents=True)
        (path/'index.md').write_text(
            f'---\nid: {name}\nstatus: completed\ncontract: C01-change.md\n'
            'design: C02-design.md\ntasks: C03-tasks\n'
            'graph: C03-tasks/C03-task-graph.json\n---\n')
        (path/'C01-change.md').write_text('fixture ' + SECRET)
        (path/'C02-design.md').write_text('# fixture design\n')
        h = history if history is not None else [
            {'state':'running','attempt':1},
            {'state':'submitted','attempt':1},
            {'state':'accepted','attempt':1},
        ]
        (tasks/'C03-task-graph.json').write_text(json.dumps({
            'tasks':[{'id':'C03-01','state':'accepted','attempt':1,'history':h}]
        }))
        return name, path

    def test_script_never_calls_model_network_or_subprocess(self):
        with patch.object(socket, 'create_connection', side_effect=AssertionError('network')), \
             patch.object(subprocess, 'Popen', side_effect=AssertionError('process')):
            run = self.run_analysis()
            with closing(open_store(self.dbpath)) as db:
                save(db, 'example', run)
                self.assertEqual(0, load(db, 'example')['metrics']['diagnostic_model_calls'])

    def test_current_rule_restriction_not_model_error(self):
        run = self.run_analysis()
        f = next(f for f in run['findings'] if f['rule'] == 'D02')
        self.assertEqual('policy_restriction', f['category'])
        self.assertIn('不证明该轮已加载', f['conclusion'])

    def test_runtime_instructions_have_evidence(self):
        rows = log_rows() + [envelope('response_item', {'type':'message','role':'user','content':[{'type':'input_text','text':'# AGENTS.md instructions for /local/project\n<INSTRUCTIONS>\n'+RULES+'\n</INSTRUCTIONS>'}]},3),end()]
        run = self.run_analysis(rows)
        f = next(f for f in run['findings'] if f['rule']=='D02')
        self.assertIn('运行时指令', f['conclusion'])
        self.assertTrue(any(':L' in s for s in f['evidence']))

    def test_policy_in_tool_output_is_not_instruction_evidence(self):
        rows = log_rows() + [tool('x','shell_command',{'command':'cat dummy'}),output('x', {'exit_code':0,'text':RULES}),end()]
        run = self.run_analysis(rows)
        self.assertEqual([], run['sessions'][0]['policies'])

    def test_failed_spawn_is_not_missing_spawn(self):
        run = self.run_analysis(log_rows()+[tool('x','spawn_agent',{'agent_type':'explorer'}),output('x',{'error':SECRET}),end()])
        self.assertIn('D01', self.rules_found(run))
        self.assertNotIn('D02', self.rules_found(run))
        self.assertEqual(1, run['metrics']['spawn_failed'])

    def test_missing_explorer_with_no_rules_is_unknown(self):
        (self.rules/'AGENTS.md').unlink()
        run=self.run_analysis()
        self.assertIn('D03', self.rules_found(run))
        self.assertNotIn('D02', self.rules_found(run))

    def test_quick_without_sdd_is_not_violation(self):
        run=self.run_analysis(expected='quick',roles=())
        self.assertFalse(any(f['rule'].startswith('S') for f in run['findings']))
        self.assertNotIn('P01', self.rules_found(run))

    def test_unknown_mode_no_inferred_requirement(self):
        run=self.run_analysis(expected='unknown',roles=())
        self.assertNotIn('S01', self.rules_found(run))

    def test_missing_sdd_trace_is_candidate_not_confirmed_violation(self):
        run=self.run_analysis()
        self.assertEqual('needs_review',next(f['category'] for f in run['findings'] if f['rule']=='S01'))

    def test_known_command_failure_has_positive_evidence(self):
        rows=log_rows()+[tool('x','exec_command',{'cmd':'python3 sdd-do/scripts/prepare_workspace.py CHG-20260923-test C02-01'}),output('x',{'exit_code':1,'stderr':SECRET}),end()]
        self.assertIn('S03', self.rules_found(self.run_analysis(rows)))

    def test_echoed_command_does_not_count_as_execution(self):
        fact=command_fact('echo "python3 sdd-change/scripts/task_graph.py --action approve"')
        self.assertEqual('other.command',fact['kind'])
        self.assertEqual('opaque',command_fact('python3 -c "import os"')['kind'])

    def test_shell_compound_is_opaque_not_invented_sequence(self):
        self.assertEqual('opaque',command_fact('python3 sdd-do/scripts/prepare_workspace.py X && echo yes')['kind'])

    def test_skill_read_requires_success(self):
        rows=log_rows()+[tool('x','exec_command',{'cmd':'cat /home/u/.codex/skills/sdd-do/SKILL.md'}),output('x',{'exit_code':0,'text':SECRET}),end()]
        run=self.run_analysis(rows)
        self.assertEqual(1,run['metrics']['skill_read_commands'])
        rows[-2]=output('x',{'exit_code':1})
        self.assertEqual(0,self.run_analysis(rows)['metrics']['skill_read_commands'])

    def test_no_agents_read_not_treated_as_unloaded(self):
        run=self.run_analysis()
        self.assertIn('P01',self.rules_found(run))
        self.assertTrue(any('不能据此判断' in f['conclusion'] for f in run['findings']))

    def test_namespaced_spawn_and_child_join(self):
        self.write(log_rows('child','root','explorer','c1')+[end(40)],'child.jsonl')
        run=self.run_analysis(log_rows()+[tool('x','agents.spawn_agent',{'agent_type':'explorer','fork_turns':'none'}),output('x',{'agent_id':'child'}),end()])
        self.assertEqual(2,run['metrics']['sessions_observed'])
        self.assertEqual('explorer',run['sessions'][1]['role'])
        self.assertNotIn('D03',self.rules_found(run))

    def test_missing_child_does_not_mean_zero_cost(self):
        run=self.run_analysis(log_rows()+[tool('x','spawn_agent',{'agent_type':'explorer'}),output('x',{'agent_id':'child'}),end()])
        self.assertIn('child_rollout_missing',run['coverage']['issues'])
        self.assertIsNone(run['metrics']['usage_observed'])

    def test_nested_children_are_linked_by_id(self):
        self.write(log_rows('a','root','architect','a1')+[tool('nested','spawn_agent',{'agent_type':'explorer'},10),output('nested',{'agent_id':'e'},11),end(45)],'a.jsonl')
        self.write(log_rows('e','a','explorer','e1')+[end(40)],'e.jsonl')
        run=self.run_analysis(log_rows()+[tool('x','spawn_agent',{'agent_type':'architect'}),output('x',{'agent_id':'a'}),end()],roles=())
        self.assertEqual(3,run['metrics']['sessions_observed'])

    def test_native_collab_does_not_double_count(self):
        rows=log_rows()+[tool('x','spawn_agent',{'agent_type':'explorer'}),
                        envelope('event_msg',{'type':'collab_agent_spawn_end','call_id':'x','new_thread_id':'child','new_agent_role':'explorer'},4),
                        output('x',{'agent_id':'child'},5),end()]
        run=self.run_analysis(rows)
        self.assertEqual(1,run['metrics']['spawn_attempts'])
        self.assertEqual(1,run['metrics']['spawn_success'])

    def test_native_exec_overrides_opaque_wrapper_without_double_counting(self):
        rows=log_rows()+[tool('x','exec',{'command':'opaque JS'}),
             envelope('event_msg',{'type':'exec_command_begin','call_id':'x','command':['cat','/skills/sdd-do/SKILL.md']},4),
             envelope('event_msg',{'type':'exec_command_end','call_id':'x','exit_code':0},5),end()]
        run=self.run_analysis(rows)
        self.assertEqual(1,run['metrics']['skill_read_commands'])

    def test_opaque_code_mode_discloses_partial_coverage(self):
        rows=log_rows()+[tool('x','exec',{'input':'tools.spawn_agent(...)'}),output('x',{'exit_code':0}),end()]
        self.assertIn('opaque_tool_execution',self.run_analysis(rows)['coverage']['issues'])

    def test_partial_json_and_missing_end_are_reported(self):
        path=self.write(log_rows())
        with path.open('a') as f:f.write('{"payload":')
        run=diagnose(collect(self.project,self.rules,path))
        self.assertIn('invalid_or_partial_json',run['coverage']['issues'])
        self.assertIn('turn_end_missing',run['coverage']['issues'])

    def test_unknown_native_event_is_not_silently_accepted(self):
        run=self.run_analysis(log_rows()+[envelope('event_msg',{'type':'future_executor'},3),end()])
        self.assertIn('unknown_event',run['coverage']['issues'])

    def test_multiple_user_turns_need_explicit_selection(self):
        rows=log_rows()+[end(20),envelope('event_msg',{'type':'task_started','turn_id':'t2'},21),end()]
        with self.assertRaisesRegex(ValueError,'multiple turns'):self.run_analysis(rows)
        run=self.run_analysis(rows,turn='t2')
        self.assertEqual('t2',run['turn'])
        self.assertEqual(29,run['metrics']['wall_seconds'])

    def test_unrelated_sessions_not_imported(self):
        self.write(log_rows('other')+[end()],'other.jsonl')
        self.assertEqual(1,self.run_analysis()['metrics']['sessions_observed'])

    def test_explicit_child_parent_conflict_is_partial(self):
        self.write(log_rows('child','different','explorer')+[end()],'child.jsonl')
        run=self.run_analysis(log_rows()+[tool('x','spawn_agent',{'agent_type':'explorer'}),output('x',{'agent_id':'child'}),end()])
        self.assertIn('conflicting_parent',run['coverage']['issues'])
        self.assertEqual(1,run['metrics']['sessions_observed'])

    def test_cumulative_usage_not_summed_repeatedly(self):
        def usage(n,t):return envelope('event_msg',{'type':'token_count','info':{'total_token_usage':{'input_tokens':n,'cached_input_tokens':0,'output_tokens':10}}},t)
        run=self.run_analysis(log_rows()+[usage(100,10),usage(100,11),usage(130,12),end()])
        self.assertEqual(130,run['metrics']['usage_observed']['input_tokens'])

    def test_partial_turn_usage_subtracts_prior_total(self):
        def usage(n,t):return envelope('event_msg',{'type':'token_count','info':{'total_token_usage':{'input_tokens':n}}},t)
        rows=log_rows()+[usage(100,15),end(20),envelope('event_msg',{'type':'task_started','turn_id':'t2'},21),usage(125,30),end()]
        run=self.run_analysis(rows,turn='t2')
        self.assertEqual(25,run['metrics']['usage_observed']['input_tokens'])

    def test_counter_reset_is_unknown(self):
        def usage(n,t):return envelope('event_msg',{'type':'token_count','info':{'total_token_usage':{'input_tokens':n}}},t)
        rows=log_rows()+[usage(100,15),end(20),envelope('event_msg',{'type':'task_started','turn_id':'t2'},21),usage(25,30),end()]
        run=self.run_analysis(rows,turn='t2')
        self.assertIsNone(run['metrics']['usage_observed'])
        self.assertIn('usage_counter_reset',run['coverage']['issues'])

    def test_history_timestamps_not_fabricated(self):
        change,_=self.make_change()
        run=self.run_analysis(change=change)
        self.assertTrue(all(e['at'] is None for e in run['sdd']['events']))
        self.assertEqual({'numerator':1,'denominator':1},run['metrics']['first_pass'])

    def test_direct_rework_and_dependency_invalidation_separate(self):
        h=[{'state':'planned','action':'rework','invalidated_by':'C03-01'},
           {'state':'planned','action':'rework','invalidated_by':'C03-02'}]
        change,_=self.make_change(h)
        m=self.run_analysis(change=change)['metrics']
        self.assertEqual(1,m['direct_rework']);self.assertEqual(1,m['dependency_invalidations'])

    def test_change_mapping_escape_refused(self):
        change,p=self.make_change()
        (p/'index.md').write_text(f'---\nid: {change}\nstatus: completed\ncontract: ../secret\n---\n')
        with self.assertRaises(ValueError):self.run_analysis(change=change)

    def test_unknown_change_is_an_artifact_gap(self):
        self.assertIn('S02',self.rules_found(self.run_analysis(change='CHG-20260923-missing')))

    def test_raw_conversation_commands_and_secrets_not_persisted(self):
        rows=log_rows()+[envelope('response_item',{'type':'reasoning','summary':[{'text':SECRET}]},3),
              envelope('response_item',{'type':'message','role':'user','content':[{'type':'input_text','text':SECRET}]},4),
              tool('x','shell_command',{'command':'echo '+SECRET},5),output('x',{'exit_code':0,'text':SECRET},6),end()]
        run=self.run_analysis(rows)
        with closing(open_store(self.dbpath)) as db:
            saved=save(db,'private',run)
            self.assertNotIn(SECRET,json.dumps(saved))
            self.assertNotIn(SECRET,markdown(saved))
        self.assertNotIn(SECRET.encode(),self.dbpath.read_bytes())
        self.assertEqual(0o600,self.dbpath.stat().st_mode & 0o777)

    def test_idempotent_collection_replaces_run_not_counts(self):
        run=self.run_analysis()
        with closing(open_store(self.dbpath)) as db:
            save(db,'same',run);save(db,'same',run)
            self.assertEqual(1,len(all_runs(db)))

    def test_reusing_run_id_for_other_scope_refused(self):
        run=self.run_analysis()
        with closing(open_store(self.dbpath)) as db:
            save(db,'same',run)
            other=dict(run,root_session='another')
            with self.assertRaisesRegex(ValueError,'different scope'):save(db,'same',other)
            self.assertEqual('root',load(db,'same')['root_session'])

    def test_store_symlink_refused(self):
        target=self.base/'target';target.write_text('do not touch')
        self.dbpath.symlink_to(target)
        with self.assertRaises(ValueError):open_store(self.dbpath)
        self.assertEqual('do not touch',target.read_text())

    def test_raw_log_symlink_refused(self):
        real=self.write();link=self.sessions/'link.jsonl';link.symlink_to(real)
        with self.assertRaises(ValueError):read_rollout(link)

    def test_unknown_db_version_refused(self):
        with closing(open_store(self.dbpath)) as db:db.execute('PRAGMA user_version=2')
        with self.assertRaisesRegex(ValueError,'version'):open_store(self.dbpath)

    def test_current_snapshot_not_effective_history(self):
        run=self.run_analysis()
        self.assertEqual('current_inventory_not_proven_active',run['configuration_basis'])
        self.assertTrue(all(x['evidence']=='current_inventory_not_runtime' for x in run['snapshots']))

    def test_summary_retains_denominators_and_no_causal_claim(self):
        run=dict(self.run_analysis(),run_id='demo')
        text=summary([run])
        self.assertIn('0/0',text)
        self.assertIn('不宣称',text)

    def test_cli_collect_report_and_summary(self):
        path=self.write()
        prefix=[sys.executable,str(ROOT/'sdd-do/scripts/observe.py'),'--db',str(self.dbpath)]
        command=prefix+['collect','--root',str(self.project),'--rules-root',str(self.rules),'--run','cli',
                        '--session-file',str(path),'--expected-mode','sdd','--expect-role','explorer']
        result=subprocess.run(command,capture_output=True,text=True)
        self.assertEqual(0,result.returncode,result.stderr)
        self.assertEqual(0,json.loads(result.stdout)['diagnostic_model_calls'])
        for action in [['report','--run','cli'],['summary']]:
            out=subprocess.run(prefix+action,capture_output=True,text=True)
            self.assertEqual(0,out.returncode,out.stderr)
            self.assertIn('# ',out.stdout)

    def test_cli_db_cannot_be_written_inside_project(self):
        path=self.write()
        result=subprocess.run([sys.executable,str(ROOT/'sdd-do/scripts/observe.py'),'--db',str(self.project/'bad.db'),
                               'collect','--run','x','--root',str(self.project),'--session-file',str(path)],capture_output=True,text=True)
        self.assertNotEqual(0,result.returncode)
        self.assertFalse((self.project/'bad.db').exists())

    def test_installed_layout_has_script_modules(self):
        # Installer copies existing managed sdd-do tree; no extra skill or global prompt required.
        sys.path.insert(0,str(ROOT/'scripts'))
        import install
        home=self.base/'installed'
        install.install(ROOT,home,validate=False)
        result=subprocess.run([sys.executable,str(home/'skills/sdd-do/scripts/observe.py'),'--help'],capture_output=True,text=True)
        self.assertEqual(0,result.returncode,result.stderr)


class BatchObservationTests(unittest.TestCase):
    setUp = ObservationTests.setUp
    write = ObservationTests.write
    run_analysis = ObservationTests.run_analysis
    make_change = ObservationTests.make_change
    def test_scan_needs_no_agent_instrumentation(self):
        from observation.collect import scan_runs
        rows=log_rows(); rows[0]['payload']['cwd']=str(self.project)
        self.write(rows+[end()])
        runs,skipped=scan_runs(self.project,self.rules,self.sessions,'2026-09-23')
        self.assertEqual(1,len(runs));self.assertEqual(0,skipped)
        self.assertEqual('unknown',runs[0][1]['expectation']['mode'])

    def test_scan_splits_two_user_turns(self):
        from observation.collect import scan_runs
        rows=log_rows();rows[0]['payload']['cwd']=str(self.project)
        rows += [end(20),envelope('event_msg',{'type':'task_started','turn_id':'t2'},21),end()]
        self.write(rows)
        self.assertEqual(2,len(scan_runs(self.project,self.rules,self.sessions)[0]))

    def test_scan_limit_fails_instead_of_silent_truncation(self):
        from observation.collect import scan_runs
        for i in range(2):
            rows=log_rows('root'+str(i));rows[0]['payload']['cwd']=str(self.project)
            self.write(rows+[end()],str(i)+'.jsonl')
        with self.assertRaisesRegex(ValueError,'max-runs'):scan_runs(self.project,self.rules,self.sessions,max_runs=1)

    def test_explicit_group_deduplicates_task_snapshot(self):
        from observation.diagnose import group_runs
        name,_=self.make_change()
        a=dict(self.run_analysis(change=name),run_id='a')
        b=dict(self.run_analysis(log_rows('second')+[end()],change=name),run_id='b')
        joined=group_runs([a,b]);joined['run_id']='joined'
        self.assertEqual(2,joined['metrics']['member_runs'])
        self.assertEqual(1,len(joined['sdd']['tasks']))
        self.assertEqual(1,joined['metrics']['first_pass']['denominator'])
        self.assertIn('分组成员',markdown(joined))

    def test_group_rejects_overlapping_slices(self):
        from observation.diagnose import group_runs
        a=dict(self.run_analysis(),run_id='a')
        with self.assertRaisesRegex(ValueError,'Overlapping'):group_runs([a,dict(a,run_id='b')])

    def test_resumed_worker_imports_original_session(self):
        self.write(log_rows('worker','old-parent','worker','w1')+[end(40)],'worker.jsonl')
        run=self.run_analysis(log_rows()+[tool('resume','resume_agent',{'id':'worker'}),output('resume',{'status':'running'}),end()],roles=())
        self.assertEqual(2,run['metrics']['sessions_observed'])
        self.assertEqual(1,run['metrics']['resume_attempts'])
        self.assertEqual('worker',run['sessions'][1]['role'])

    def test_source_code_has_no_network_or_model_sdk(self):
        import ast
        forbidden={'subprocess','socket','requests','urllib','openai','http','anthropic'}
        for path in (ROOT/'sdd-do/scripts/observation').glob('*.py'):
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node,ast.Import):
                    self.assertTrue(forbidden.isdisjoint(n.name.split('.')[0] for n in node.names))
                if isinstance(node,ast.ImportFrom):
                    self.assertNotIn((node.module or '').split('.')[0],forbidden)
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Name):
                    self.assertNotIn(node.func.id,{'eval','exec'})

    def test_existing_foreign_database_is_not_modified(self):
        import sqlite3
        db=sqlite3.connect(self.dbpath);db.execute('CREATE TABLE user_data(value TEXT)');db.commit();db.close()
        self.dbpath.chmod(0o600)
        before=self.dbpath.read_bytes()
        with self.assertRaisesRegex(ValueError,'not an observation'):open_store(self.dbpath)
        self.assertEqual(before,self.dbpath.read_bytes())

    def test_implementation_before_change_is_only_a_candidate(self):
        rows=log_rows()+[tool('write','apply_patch',{}),output('write',{'exit_code':0}),
             tool('create','exec_command',{'cmd':'python3 sdd-change/scripts/new_change.py demo'},5),
             output('create',{'exit_code':0},6),end()]
        run=self.run_analysis(rows)
        self.assertEqual('needs_review',next(f['category'] for f in run['findings'] if f['rule']=='S05'))

    def test_mcp_tool_cannot_impersonate_native_spawn(self):
        run=self.run_analysis(log_rows()+[tool('x','mcp__server__spawn_agent',{'agent_type':'explorer'}),output('x',{'agent_id':'child'}),end()])
        self.assertEqual(0,run['metrics']['spawn_attempts'])

    def test_fenced_policy_example_is_not_active_rule(self):
        (self.rules/'AGENTS.md').write_text('```md\n'+RULES+'```\n')
        run=self.run_analysis()
        self.assertFalse(any(f['rule']=='D02' for f in run['findings']))

    def test_missing_scope_does_not_mutate_database(self):
        with closing(open_store(self.dbpath)) as db:
            before=all_runs(db)
            with self.assertRaises(ValueError):load(db,'missing')
            self.assertEqual(before,all_runs(db))

    def test_malformed_native_fields_degrade_coverage(self):
        rows=log_rows()+[tool('x','spawn_agent',{'agent_type':['not','a','role']}),end()]
        run=self.run_analysis(rows)
        self.assertIn('invalid_payload',run['coverage']['issues'])

    def test_conflicting_session_identity_is_not_silently_joined(self):
        rows=log_rows()+[envelope('session_meta',{'id':'other'},3),end()]
        run=self.run_analysis(rows)
        self.assertEqual('root',run['root_session'])
        self.assertIn('session_identity_conflict',run['coverage']['issues'])


    def test_partial_usage_fields_stay_unknown(self):
        rows=log_rows()+[envelope('event_msg',{'type':'token_count','info':{'total_token_usage':{'input_tokens':10}}},10),end()]
        run=self.run_analysis(rows)
        self.assertEqual(10,run['metrics']['usage_observed']['input_tokens'])
        self.assertIsNone(run['metrics']['usage_observed']['output_tokens'])
        self.assertIsNone(run['metrics']['usage_observed']['cached_input_tokens'])

    def test_summary_deduplicates_same_change_across_turns(self):
        name,_=self.make_change()
        a=dict(self.run_analysis(change=name),run_id='a')
        b=dict(self.run_analysis(log_rows('second')+[end()],change=name),run_id='b')
        result=summary([a,b])
        self.assertIn('1/1',result)
        self.assertNotIn('2/2',result)

    def test_invalid_task_shape_has_controlled_error(self):
        name,path=self.make_change()
        (path/'C03-tasks/C03-task-graph.json').write_text(json.dumps({'tasks':[None]}))
        with self.assertRaisesRegex(ValueError,'Invalid task object'):
            self.run_analysis(change=name)

    def test_scan_invalid_header_is_skipped_as_partial(self):
        from observation.collect import scan_runs
        rows=log_rows();rows[0]['payload'].update(cwd=str(self.project),agent_role=['bad'])
        self.write(rows+[end()])
        runs,skipped=scan_runs(self.project,self.rules,self.sessions)
        self.assertEqual([],runs)
        self.assertEqual(1,skipped)


if __name__=='__main__':unittest.main()
