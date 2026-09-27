"""The simplified surface must retain the real lifecycle's identity and acceptance gates."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_sdd as fixture
from test_sdd import workflow, new_task, ensure_design, task_graph
from delivery_evidence import changed_files
from sdd_common import metadata

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lean_cli', ROOT/'sdd-change/scripts/sdd.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class LeanCliTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.LifecycleTest()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.root = self.f.root
        self.change_id = self.f.change.name
        self.evidence = Path(self.f.tmp.name)/'evidence.md'

    def prepare(self, **kwargs):
        if 'task_id' not in kwargs:
            graph = task_graph.load_graph(self.f.change/'C03-tasks/C03-task-graph.json')
            if not graph['tasks']:
                kwargs['task_id'] = self.f.task()
        return cli.prepare(self.root, self.change_id, **kwargs)

    def draft(self, info):
        return cli.deliver(self.root, self.change_id, info['task'], attempt=info['attempt'],
                           evidence_file=self.evidence, draft=True)

    def complete_report(self, info):
        self.f.commit()
        self.draft(info)
        self.evidence.write_text(self.evidence.read_text().replace('待补充。', '已核查 AC-01 的测试夹具行为。'))
        return cli.deliver(self.root, self.change_id, info['task'], attempt=info['attempt'], evidence_file=self.evidence)

    def test_prepare_requires_at_least_one_canonical_task(self):
        before = {str(p): p.read_bytes() for p in self.f.change.rglob('*') if p.is_file()}
        with self.assertRaises(ValueError):
            cli.prepare(self.root, self.change_id)
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.f.change.rglob('*') if p.is_file()})
        self.assertEqual('C03-tasks/C03-task-graph.json', self.f.fields['graph'])

    def test_independent_tasks_are_ready_for_parallel_dispatch(self):
        first = self.f.task('backend')
        second = self.f.task('frontend')
        graph = self.f.ctx(first)[3]
        ready = task_graph.validate_graph(graph)['ready']
        self.assertCountEqual([first, second], ready)
        self.assertEqual([], self.f.info(first)['depends_on'])
        self.assertEqual([], self.f.info(second)['depends_on'])

    def test_resume_keeps_original_identity_and_does_not_redispatch(self):
        first = self.prepare()
        before = self.f.ctx(first['task'])[2].read_bytes()
        second = self.prepare()
        self.assertTrue(second['resume'])
        for key in ('task', 'attempt', 'baseline', 'workspace', 'contract_digest'):
            self.assertEqual(first[key], second[key])
        self.assertEqual(before, self.f.ctx(first['task'])[2].read_bytes())

    def test_prepare_returns_worker_dispatch_packet_and_allowed_actions(self):
        info = self.prepare()
        self.assertEqual('worker', info['dispatch']['role'])
        self.assertEqual('sdd', info['dispatch']['mode'])
        self.assertEqual(info['task_contract'], info['dispatch']['artifacts']['task_contract'])
        self.assertEqual(info['attempt'], info['dispatch']['runtime']['attempt'])
        self.assertIn('bind_session', info['allowed_actions'])
        self.assertIn('deliver', info['allowed_actions'])
        packet = json.dumps(info['dispatch'], ensure_ascii=False)
        for foreign in ('Main', 'Architect', 'Reviewer', 'Explorer', 'Librarian'):
            self.assertNotIn(foreign, packet)

    def test_bind_session_is_stable_and_resume_exposes_original_worker(self):
        info = self.prepare()
        bound = cli.bind_session(self.root, self.change_id, info['task'], 'worker-thread-1')
        self.assertEqual('worker-thread-1', bound['agent_session'])
        self.assertEqual('worker-thread-1', bound['dispatch']['runtime']['agent_session'])
        with self.assertRaises(ValueError):
            cli.bind_session(self.root, self.change_id, info['task'], 'worker-thread-2')
        resumed = self.prepare()
        self.assertTrue(resumed['resume'])
        self.assertEqual('worker-thread-1', resumed['agent_session'])
        self.assertIn('resume_worker', resumed['allowed_actions'])
        self.assertNotIn('bind_session', resumed['allowed_actions'])

    def test_status_reports_state_dependencies_and_legal_actions(self):
        task = self.f.task()
        before = cli.status(self.root, self.change_id, task)
        self.assertTrue(before['graph_ready'])
        self.assertEqual('planned', before['tasks'][0]['state'])
        self.assertIn('prepare', before['tasks'][0]['allowed_actions'])
        info = self.prepare(task_id=task)
        cli.bind_session(self.root, self.change_id, task, 'worker-thread-status')
        running = cli.status(self.root, self.change_id, task)
        self.assertEqual('running', running['tasks'][0]['state'])
        self.assertEqual('worker-thread-status', running['tasks'][0]['agent_session'])
        self.assertIn('resume_worker', running['tasks'][0]['allowed_actions'])
        self.assertEqual(info['attempt'], running['tasks'][0]['attempt'])

    def test_status_does_not_offer_prepare_when_another_frozen_contract_drifted(self):
        first = self.f.task('backend')
        second = self.f.task('frontend')
        self.f.approve(first)
        ctx = self.f.ctx(first)
        contract = ctx[5] / ctx[6]['contract']
        contract.write_text(contract.read_text().replace(
            '在现有事务边界内更新取消状态。',
            '在新的事务边界内更新取消状态。'
        ))
        state = cli.status(self.root, self.change_id, second)['tasks'][0]
        self.assertNotIn('prepare', state['allowed_actions'])
        self.assertIn('request_replan_confirmation', state['allowed_actions'])
        self.assertTrue(any('frozen_contract_changed' in item for item in state['blocked_reasons']))
        with self.assertRaisesRegex(ValueError, 'Frozen contract changed'):
            self.prepare(task_id=second)

    def test_resume_rejects_a_different_workspace_or_baseline(self):
        self.prepare()
        with self.assertRaises(ValueError):
            self.prepare(worktree=str(Path(self.f.tmp.name)/'other'))
        self.f.commit()
        with self.assertRaises(ValueError):
            self.prepare(base='HEAD')

    def test_incomplete_change_is_rejected_for_explicit_task(self):
        task = self.f.task()
        self.f.change_doc.write_text(self.f.change_doc.read_text().replace('支持预约取消', '待补充。'))
        with self.assertRaises(ValueError):
            self.prepare(task_id=task)

    def test_incomplete_design_is_not_bypassed_by_task_graph(self):
        task = self.f.task()
        self.f.design_doc.write_text('# 公共设计\n\n待补充。\n')
        with self.assertRaises(ValueError):
            self.prepare(task_id=task)

    def test_missing_ac_prevents_explicit_task_prepare(self):
        task = self.f.task()
        self.f.change_doc.write_text(
            self.f.change_doc.read_text().replace(
                '### AC-01｜取消后状态一致',
                '### 取消后状态一致'))
        with self.assertRaises(ValueError):
            self.prepare(task_id=task)

    def test_existing_manual_task_is_not_rewritten(self):
        task = self.f.task()
        context = self.f.ctx(task)
        before = (context[5]/context[6]['contract']).read_bytes()
        info = self.prepare()
        self.assertEqual(task, info['task'])
        self.assertEqual(before, (context[5]/context[6]['contract']).read_bytes())

    def test_prepare_allows_uncommitted_sibling_task_planning_artifacts(self):
        first = self.f.task('backend')
        second = self.f.task('frontend')
        info = self.prepare(task_id=first)
        self.assertEqual(first, info['task'])
        self.assertEqual('running', self.f.info(first)['state'])
        self.assertEqual('planned', self.f.info(second)['state'])

    def test_multitask_requires_explicit_selection(self):
        first = self.f.task()
        self.f.task('frontend', [first])
        graph = self.f.ctx(first)[2]
        before = graph.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Multiple Tasks'):
            self.prepare()
        self.assertEqual(before, graph.read_bytes())
        self.assertEqual(first, self.prepare(task_id=first)['task'])

    def test_from_change_parameter_is_removed(self):
        first = self.f.task()
        before = self.f.ctx(first)[2].read_bytes()
        with self.assertRaises(TypeError):
            new_task.create_task(self.root, self.change_id, 'derived', from_change=True)
        self.assertEqual(before, self.f.ctx(first)[2].read_bytes())

    def test_unknown_task_does_not_create_a_default(self):
        with self.assertRaises(ValueError):
            self.prepare(task_id='C99-99')
        graph = task_graph.load_graph(self.f.change/'C03-tasks/C03-task-graph.json')
        self.assertEqual([], graph['tasks'])

    def test_failed_workspace_preparation_is_retryable_without_new_attempt(self):
        with patch.object(cli, 'prepare_workspace', side_effect=ValueError('injected')):
            with self.assertRaises(ValueError):
                self.prepare()
        info = self.prepare()
        self.assertEqual(1, info['attempt'])
        self.assertEqual(1, len(self.f.ctx(info['task'])[3]['tasks']))

    def test_prepare_cannot_silently_replan_contract_drift(self):
        info = self.prepare()
        graph = self.f.ctx(info['task'])[2]
        before = graph.read_bytes()
        self.f.change_doc.write_text(self.f.change_doc.read_text().replace('支持预约取消', '变更取消语义'))
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(before, graph.read_bytes())

    def test_draft_generates_exact_git_file_rows_and_no_claims(self):
        info = self.prepare()
        (self.root/'implementation.txt').write_text('implemented')
        sha = self.f.commit()
        result = self.draft(info)
        self.assertEqual('draft', result['status'])
        text = self.evidence.read_text()
        for path, operation in changed_files(self.root, info['baseline'], sha).items():
            self.assertIn(f'| `{path}` | {operation} | 待补充。 |', text)
        self.assertEqual('running', self.f.info(info['task'])['state'])
        with self.assertRaises(ValueError):
            cli.deliver(self.root, self.change_id, attempt=info['attempt'], evidence_file=self.evidence)

    def test_draft_never_overwrites_existing_evidence(self):
        info = self.prepare()
        self.f.commit()
        self.evidence.write_text('user evidence')
        with self.assertRaises(OSError):
            self.draft(info)
        self.assertEqual('user evidence', self.evidence.read_text())

    def test_draft_rejects_symlink_destination(self):
        info = self.prepare()
        victim = Path(self.f.tmp.name)/'victim'; victim.write_text('keep')
        self.evidence.symlink_to(victim)
        with self.assertRaises(ValueError):
            self.draft(info)
        self.assertEqual('keep', victim.read_text())

    def test_stale_attempt_cannot_draft_or_deliver(self):
        first = self.prepare()
        workflow.transition(self.root, self.change_id, first['task'], 'rework', 'fix', workers_stopped=True)
        second = self.prepare()
        self.assertEqual(2, second['attempt'])
        with self.assertRaises(ValueError):
            self.draft(first)
        self.assertFalse(self.evidence.exists())
        self.evidence.write_text('old evidence')
        with self.assertRaises(ValueError):
            cli.deliver(self.root, self.change_id, attempt=first['attempt'], evidence_file=self.evidence)

    def test_worker_delivery_does_not_submit_or_accept_authoritative_task(self):
        info = self.prepare()
        result = self.complete_report(info)
        self.assertEqual('report-written', result['status'])
        self.assertEqual('running', self.f.info(info['task'])['state'])
        self.assertTrue(self.f.change.exists())

    def test_full_single_task_path_requires_explicit_acceptance_and_close_evidence(self):
        info = self.prepare()
        self.complete_report(info)
        with self.assertRaises(ValueError):
            cli.close(self.root, self.change_id)
        with self.assertRaises(ValueError):
            cli.close(self.root, self.change_id, accept_task=True)
        with self.assertRaises(ValueError):
            cli.close(self.root, self.change_id, archive=True)
        self.assertEqual('running', self.f.info(info['task'])['state'])
        accepted = cli.close(self.root, self.change_id, accept_task=True, reason='AC-01 verified')
        self.assertEqual('accepted', accepted['state'])
        self.assertTrue(self.f.change.exists())
        with self.assertRaises(ValueError):
            cli.close(self.root, self.change_id, archive=True)
        self.f.verdict()
        result = cli.close(self.root, self.change_id, archive=True)
        self.assertEqual('completed', result['state'])
        self.assertFalse(self.f.change.exists())
        self.assertTrue(Path(result['path']).is_dir())

    def test_repeated_acceptance_is_idempotent_but_report_tampering_is_rejected(self):
        info = self.prepare()
        self.complete_report(info)
        cli.close(self.root, self.change_id, accept_task=True, reason='verified')
        before = self.f.ctx(info['task'])[2].read_bytes()
        cli.close(self.root, self.change_id, accept_task=True, reason='retry')
        self.assertEqual(before, self.f.ctx(info['task'])[2].read_bytes())
        report = self.f.report(info['task'])
        report.write_text(report.read_text()+'\nchanged after acceptance\n')
        with self.assertRaises(ValueError):
            cli.close(self.root, self.change_id, accept_task=True, reason='retry')

    def test_worktree_acceptance_then_integration_is_explicit_and_idempotent(self):
        task = self.f.task()
        location = Path(self.f.tmp.name)/'worker'
        self.prepare(task_id=task, worktree=str(location))
        (location/'implementation.txt').write_text('result')
        result_revision = self.f.deliver(task, location)
        before = workflow.revision(self.root, 'HEAD')
        result = cli.close(self.root, self.change_id, accept_task=True, reason='verified actual worktree report')
        self.assertEqual('accepted', result['state'])
        self.assertEqual(before, workflow.revision(self.root, 'HEAD'))

        pending = cli.status(self.root, self.change_id, task)['tasks'][0]
        self.assertEqual('pending', pending['integration'])
        self.assertIn('integrate', pending['allowed_actions'])
        preflight = cli.integrate(self.root, self.change_id, task, check_only=True)
        self.assertEqual('ready', preflight['integration'])
        self.assertEqual(before, workflow.revision(self.root, 'HEAD'))

        integrated = cli.integrate(self.root, self.change_id, task)
        self.assertEqual('integrated', integrated['integration'])
        self.assertEqual('result', (self.root/'implementation.txt').read_text())
        self.assertTrue(workflow.ancestor(self.root, result_revision, integrated['head']))
        self.assertEqual('accepted', self.f.info(task)['state'])

        current = cli.status(self.root, self.change_id, task)['tasks'][0]
        self.assertEqual('integrated', current['integration'])
        self.assertNotIn('integrate', current['allowed_actions'])
        head = workflow.revision(self.root, 'HEAD')
        self.assertEqual(head, cli.integrate(self.root, self.change_id, task)['head'])

        self.f.verdict()
        closed = cli.close(self.root, self.change_id, archive=True)
        self.assertEqual('completed', closed['state'])

    def test_wave_preflight_and_integration_cover_all_pending_accepted_tasks(self):
        first = self.f.task('backend')
        second = self.f.task('frontend')
        first_workspace = Path(self.f.tmp.name)/'wave-backend'
        second_workspace = Path(self.f.tmp.name)/'wave-frontend'
        self.prepare(task_id=first, worktree=str(first_workspace))
        self.prepare(task_id=second, worktree=str(second_workspace))

        (first_workspace/'backend.txt').write_text('backend result\n')
        (second_workspace/'frontend.txt').write_text('frontend result\n')
        first_revision = self.f.deliver(first, first_workspace)
        second_revision = self.f.deliver(second, second_workspace)
        cli.close(self.root, self.change_id, task_id=first, accept_task=True,
                  reason='verified backend wave result')
        cli.close(self.root, self.change_id, task_id=second, accept_task=True,
                  reason='verified frontend wave result')

        before = workflow.revision(self.root, 'HEAD')
        preflight = cli.integrate_wave(self.root, self.change_id, check_only=True)
        self.assertEqual('ready', preflight['integration'])
        self.assertEqual([first, second], preflight['tasks'])
        self.assertEqual(before, workflow.revision(self.root, 'HEAD'))
        self.assertFalse((self.root/'backend.txt').exists())
        self.assertFalse((self.root/'frontend.txt').exists())

        integrated = cli.integrate_wave(self.root, self.change_id)
        self.assertEqual('integrated', integrated['integration'])
        self.assertEqual([first, second], integrated['tasks'])
        self.assertEqual('backend result\n', (self.root/'backend.txt').read_text())
        self.assertEqual('frontend result\n', (self.root/'frontend.txt').read_text())
        self.assertTrue(workflow.ancestor(self.root, first_revision, integrated['head']))
        self.assertTrue(workflow.ancestor(self.root, second_revision, integrated['head']))

        repeated = cli.integrate_wave(self.root, self.change_id)
        self.assertEqual('integrated', repeated['integration'])
        self.assertEqual([], repeated['tasks'])
        self.assertEqual(integrated['head'], repeated['head'])

    def test_wave_preflight_detects_cross_task_conflict_before_main_write(self):
        (self.root/'shared.txt').write_text('base\n')
        self.f.commit()
        first = self.f.task('backend')
        second = self.f.task('frontend')
        first_workspace = Path(self.f.tmp.name)/'conflict-backend'
        second_workspace = Path(self.f.tmp.name)/'conflict-frontend'
        self.prepare(task_id=first, worktree=str(first_workspace))
        self.prepare(task_id=second, worktree=str(second_workspace))

        (first_workspace/'shared.txt').write_text('backend\n')
        (second_workspace/'shared.txt').write_text('frontend\n')
        self.f.deliver(first, first_workspace)
        self.f.deliver(second, second_workspace)
        cli.close(self.root, self.change_id, task_id=first, accept_task=True,
                  reason='verified backend conflict fixture')
        cli.close(self.root, self.change_id, task_id=second, accept_task=True,
                  reason='verified frontend conflict fixture')

        head = workflow.revision(self.root, 'HEAD')
        graph = self.f.ctx(first)[2].read_bytes()
        preflight = cli.integrate_wave(self.root, self.change_id, check_only=True)
        self.assertEqual('conflict', preflight['integration'])
        self.assertEqual(second, preflight['conflict_task'])
        self.assertIn('shared.txt', preflight['conflicts'])
        self.assertEqual(head, workflow.revision(self.root, 'HEAD'))
        self.assertEqual(graph, self.f.ctx(first)[2].read_bytes())
        self.assertEqual('base\n', (self.root/'shared.txt').read_text())

    def test_dependent_task_waits_for_accepted_result_to_enter_head(self):
        first = self.f.task()
        second = self.f.task('frontend', [first])
        location = Path(self.f.tmp.name)/'dependency-worker'
        self.prepare(task_id=first, worktree=str(location))
        (location/'implementation.txt').write_text('dependency result')
        self.f.deliver(first, location)
        cli.close(self.root, self.change_id, task_id=first, accept_task=True,
                  reason='verified dependency worktree')

        blocked = cli.status(self.root, self.change_id, second)['tasks'][0]
        self.assertNotIn('prepare', blocked['allowed_actions'])
        self.assertTrue(any(
            reason.startswith('waiting_for_integrated_dependencies:')
            for reason in blocked['blocked_reasons']
        ))

        cli.integrate(self.root, self.change_id, first)
        ready = cli.status(self.root, self.change_id, second)['tasks'][0]
        self.assertIn('prepare', ready['allowed_actions'])
        dispatched = self.prepare(task_id=second)
        self.assertEqual('running', dispatched['state'])

    def test_integration_preflight_reports_real_code_conflicts_without_mutation(self):
        (self.root/'conflict.txt').write_text('base\n')
        self.f.commit()
        task = self.f.task()
        location = Path(self.f.tmp.name)/'conflict-worker'
        self.prepare(task_id=task, worktree=str(location))
        (location/'conflict.txt').write_text('worker\n')
        self.f.deliver(task, location)

        (self.root/'conflict.txt').write_text('main\n')
        self.f.commit()
        cli.close(self.root, self.change_id, task_id=task, accept_task=True,
                  reason='verified conflicting result')
        head = workflow.revision(self.root, 'HEAD')
        graph = self.f.ctx(task)[2].read_bytes()

        preflight = cli.integrate(self.root, self.change_id, task, check_only=True)
        self.assertEqual('conflict', preflight['integration'])
        self.assertIn('conflict.txt', preflight['conflicts'])
        self.assertEqual(head, workflow.revision(self.root, 'HEAD'))
        self.assertEqual(graph, self.f.ctx(task)[2].read_bytes())
        self.assertEqual('main\n', (self.root/'conflict.txt').read_text())

    def test_submitted_upstream_does_not_unlock_dependent_task(self):
        first = self.f.task(); second = self.f.task('frontend', [first])
        self.prepare(task_id=first)
        self.f.deliver(first)
        workflow.transition(self.root, self.change_id, first, 'submit')
        with self.assertRaises(ValueError):
            self.prepare(task_id=second)
        self.assertEqual('planned', self.f.info(second)['state'])

    def test_archive_requires_canonical_task_execution(self):
        self.f.verdict()
        with self.assertRaises(ValueError):
            cli.close(self.root, self.change_id, archive=True)
        self.assertTrue(self.f.change.exists())
        graph = task_graph.load_graph(self.f.change/'C03-tasks/C03-task-graph.json')
        self.assertEqual([], graph['tasks'])

    def test_cli_returns_machine_readable_dispatch(self):
        task = self.f.task()
        result = subprocess.run([sys.executable, str(ROOT/'sdd-change/scripts/sdd.py'), 'prepare',
                                 self.change_id, '--root', str(self.root), '--task', task], text=True, capture_output=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual('running', json.loads(result.stdout)['state'])


if __name__ == '__main__':
    unittest.main()
