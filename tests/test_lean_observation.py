"""The thin CLI remains visible to diagnostics without inventing internal stages."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_observation as fixture
from observation.trace import command_fact

SCRIPT = '/installed/skills/sdd-change/scripts/sdd.py'
VALIDATION = '/installed/skills/sdd-close/scripts/run_validation.py'
CHANGE = 'CHG-20260923-example'


class LeanObservationTests(unittest.TestCase):
    def setUp(self):
        self.f = fixture.ObservationTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)

    def command(self, action, *options):
        return ['python3', '-B', SCRIPT, action, CHANGE, *options]

    def analyze_command(self, command, code=0):
        rows = fixture.log_rows()+[
            fixture.tool('lean', 'shell_command', {'command': command}),
            fixture.output('lean', {'exit_code': code, 'text': fixture.SECRET}), fixture.end()]
        return self.f.run_analysis(rows, roles=())

    def test_prepare_and_explicit_task_identity(self):
        fact = command_fact(self.command('prepare', '--task', 'C02-01'))
        self.assertEqual({'kind': 'task.prepare', 'change_id': CHANGE, 'task_id': 'C02-01'}, fact)

    def test_status_and_bind_session_are_observable_without_inventing_stages(self):
        status = command_fact(self.command('status', '--task', 'C02-01'))
        bind = command_fact(self.command('bind-session', '--task', 'C02-01',
                                         '--agent-session', 'worker-thread-1'))
        self.assertEqual('task.status', status['kind'])
        self.assertEqual('task.bind-session', bind['kind'])
        self.assertEqual('C02-01', bind['task_id'])

    def test_default_task_identity_is_not_invented(self):
        fact = command_fact(self.command('prepare'))
        self.assertEqual(CHANGE, fact['change_id'])
        self.assertIsNone(fact['task_id'])

    def test_draft_is_not_counted_as_formal_delivery(self):
        draft = command_fact(self.command('deliver', '--draft', '--attempt', '1', '--evidence-file', '/tmp/result.md'))
        final = command_fact(self.command('deliver', '--attempt', '1', '--evidence-file', '/tmp/result.md'))
        self.assertEqual('task.delivery-draft', draft['kind'])
        self.assertEqual('task.deliver', final['kind'])

    def test_integration_actions_are_observed_without_inventing_merge_stages(self):
        preflight = command_fact(self.command('integrate', '--task', 'C02-01', '--check'))
        integrate = command_fact(self.command('integrate', '--task', 'C02-01'))
        self.assertEqual({'kind': 'task.integrate-preflight', 'change_id': CHANGE, 'task_id': 'C02-01'}, preflight)
        self.assertEqual({'kind': 'task.integrate', 'change_id': CHANGE, 'task_id': 'C02-01'}, integrate)

    def test_wave_integration_is_observed_as_one_change_level_command(self):
        preflight = command_fact(self.command('integrate', '--wave', '--check'))
        integrate = command_fact(self.command('integrate', '--wave'))
        self.assertEqual(
            {'kind': 'change.integrate-wave-preflight', 'change_id': CHANGE, 'task_id': None},
            preflight,
        )
        self.assertEqual(
            {'kind': 'change.integrate-wave', 'change_id': CHANGE, 'task_id': None},
            integrate,
        )
        run = self.analyze_command(self.command('integrate', '--wave'))
        self.assertEqual(1, run['metrics']['sdd_successful_commands'])

    def test_integration_validation_is_an_observable_single_command(self):
        fact = command_fact(['python3', '-B', VALIDATION, CHANGE, '--revision', 'HEAD'])
        self.assertEqual({'kind': 'change.validate', 'change_id': CHANGE, 'task_id': None}, fact)

    def test_accept_and_archive_are_distinct_single_invocations(self):
        for options, kind in [(('--accept',), 'task.accept'), (('--archive',), 'change.close'),
                              (('--accept', '--archive'), 'change.close')]:
            self.assertEqual(kind, command_fact(self.command('close', *options))['kind'])
        run = self.analyze_command(self.command('close', '--accept', '--archive', '--reason', fixture.SECRET))
        self.assertEqual(1, run['metrics']['sdd_successful_commands'])
        self.assertEqual(0, run['metrics']['tasks_currently_accepted'])
        self.assertNotIn(fixture.SECRET, json.dumps(run))

    def test_help_unknown_actions_and_noncanonical_path_are_not_workflow_steps(self):
        for command in [self.command('prepare', '--help'), self.command('unknown'), self.command('close'),
                        ['python3', '/installed/skills/sdd-do/scripts/sdd.py', 'prepare', CHANGE]]:
            self.assertEqual('other.command', command_fact(command)['kind'])

    def test_compound_and_interpolated_shell_remain_opaque(self):
        for command in [f'python3 {SCRIPT} prepare {CHANGE} && echo done',
                        'python3 "$SDD" prepare "$CHG"']:
            self.assertEqual('opaque', command_fact(command)['kind'])

    def test_facade_success_is_not_misdiagnosed_as_missing_sdd(self):
        run = self.analyze_command(self.command('prepare'))
        self.assertEqual(1, run['metrics']['sdd_successful_commands'])
        self.assertNotIn('S01', self.f.rules_found(run))
        self.assertEqual(0, run['metrics']['tasks_currently_accepted'])

    def test_failed_combined_close_does_not_claim_acceptance_or_archive(self):
        run = self.analyze_command(self.command('close', '--accept', '--archive', '--reason', 'checked'), code=1)
        self.assertEqual(0, run['metrics']['sdd_successful_commands'])
        self.assertIn('S03', self.f.rules_found(run))
        self.assertEqual(0, run['metrics']['tasks_currently_accepted'])

    def test_new_adapter_is_still_offline_without_process_or_model_calls(self):
        with patch.object(socket, 'create_connection', side_effect=AssertionError('network')), \
             patch.object(subprocess, 'Popen', side_effect=AssertionError('process')):
            run = self.analyze_command(self.command('deliver', '--draft'))
        self.assertEqual(0, run['metrics']['diagnostic_model_calls'])
        self.assertEqual('1.1.0', run['analyzer_version'])


if __name__ == '__main__':
    unittest.main()
