"""Correct CodeGraph identity, safe legacy migration and local API-key preflight."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch

from test_install import installer, snapshot

ROOT = Path(__file__).resolve().parents[1]
KEYS = {'CONTEXT7_API_KEY': 'test-context7-not-a-real-secret',
        'TAVILY_API_KEY': 'test-tavily-not-a-real-secret'}


def fake_package(prefix, package, binary):
    """Model the real npm package/entrypoint/symlink layout, not just a filename."""
    package_dir = prefix/'node_modules'/package
    entry = package_dir/'dist/bin'/f'{binary}.js'
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text('#!/usr/bin/env node\n// test fixture only\n')
    entry.chmod(0o755)
    (package_dir/'package.json').write_text(json.dumps({'name': package, 'version': '1.0.0'}))
    binary_path = prefix/'node_modules/.bin'/binary
    binary_path.parent.mkdir(parents=True, exist_ok=True)
    if binary_path.is_symlink() or binary_path.exists():
        binary_path.unlink()
    binary_path.symlink_to(os.path.relpath(entry, binary_path.parent))
    return binary_path


class ResearchToolTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='sdd-research-tools-')
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.home = self.tmp/'home'
        self.env_patch = patch.dict(os.environ, KEYS)
        self.env_patch.start(); self.addCleanup(self.env_patch.stop)
        self.calls = []
        self.reports = []

    def config(self, content):
        self.home.mkdir(parents=True, exist_ok=True)
        (self.home/'config.toml').write_text(content)

    def which(self, name):
        return {'node': '/fixture/node', 'npm': '/fixture/npm'}.get(name)

    def fake_run(self, command, **kwargs):
        self.calls.append(command)
        self.assertNotIn('shell', kwargs)
        for key in KEYS:
            self.assertNotIn(key, kwargs['env'])
        if command[0] == '/fixture/node':
            return subprocess.CompletedProcess(command, 0, 'v22.18.0\n', '')
        self.assertEqual('/fixture/npm', command[0])
        self.assertNotIn('-g', command)
        package = command[-1].removesuffix('@latest')
        self.assertTrue(command[-1].endswith('@latest'))
        item = next(row for row in installer.RESEARCH_TOOLS if row[1] == package)
        prefix = Path(command[command.index('--prefix')+1])
        self.assertEqual(self.home/installer.TOOLS_DIR/item[0], prefix)
        fake_package(prefix, package, item[2])
        return subprocess.CompletedProcess(command, 0, '', '')

    def ensure(self, dry_run=False):
        with patch.object(installer.shutil, 'which', side_effect=self.which), \
             patch.object(installer.subprocess, 'run', side_effect=self.fake_run):
            return installer.ensure_research_tools(self.home, dry_run, self.reports.append)

    def npm_calls(self):
        return [cmd for cmd in self.calls if cmd[0] == '/fixture/npm']

    def test_correct_package_and_mcp_arguments_in_fresh_config(self):
        commands = self.ensure()
        config = tomllib.loads(installer.merged_config(ROOT, self.home/'config.toml', commands))
        self.assertEqual(str(self.home/installer.TOOLS_DIR/'codegraph/node_modules/.bin/codegraph'),
                         config['mcp_servers']['codegraph']['command'])
        self.assertEqual(['serve', '--mcp'], config['mcp_servers']['codegraph']['args'])
        self.assertIn('@colbymchenry/codegraph@latest', [c[-1] for c in self.npm_calls()])
        self.assertFalse(any('@astudioplus' in str(c) for c in self.calls))
        for key, value in KEYS.items():
            self.assertNotIn(value, json.dumps(config))
            server = 'context7' if key.startswith('CONTEXT7') else 'tavily'
            self.assertIn(key, config['mcp_servers'][server]['env_vars'])

    def test_separate_prefixes_and_second_run_reuses_all_packages(self):
        commands = self.ensure()
        self.assertEqual(3, len(self.npm_calls()))
        self.config(installer.merged_config(ROOT, self.home/'config.toml', commands))
        before = snapshot(self.home)
        self.calls.clear()
        self.assertEqual(commands, self.ensure())
        self.assertEqual([], self.calls)
        self.assertEqual(before, snapshot(self.home))

    def test_each_key_is_required_even_with_existing_mcp_entries(self):
        self.config('[mcp_servers.context7]\nurl="https://example.test/context7"\n'
                    '[mcp_servers.tavily]\nurl="https://example.test/tavily"\n')
        before = snapshot(self.home)
        for key in KEYS:
            with self.subTest(key=key), patch.dict(os.environ, KEYS, clear=True):
                os.environ.pop(key)
                with patch.object(installer.subprocess, 'run') as run:
                    with self.assertRaisesRegex(ValueError, key):
                        installer.ensure_research_tools(self.home)
                run.assert_not_called()
                self.assertEqual(before, snapshot(self.home))

    def test_unset_empty_and_whitespace_keys_all_fail_before_writes(self):
        for value in (None, '', ' \t\n'):
            with self.subTest(value=value), patch.dict(os.environ, {}, clear=True):
                if value is not None:
                    os.environ.update({key: value for key in KEYS})
                with patch.object(installer.subprocess, 'run') as run:
                    with self.assertRaises(ValueError) as error:
                        installer.ensure_research_tools(self.home)
                run.assert_not_called()
                for key in KEYS:
                    self.assertIn(key, str(error.exception))
                self.assertFalse(self.home.exists())

    def test_check_reports_names_only_and_does_not_authenticate(self):
        with patch.object(installer.subprocess, 'run') as run:
            self.assertEqual([], installer.check_research_keys(reporter=self.reports.append))
        run.assert_not_called()
        output = '\n'.join(self.reports)
        for key, value in KEYS.items():
            self.assertIn(key, output)
            self.assertNotIn(value, output)
        self.assertIn('not authenticated', output)

    def test_dotenv_file_does_not_substitute_for_exported_environment(self):
        self.home.mkdir()
        (self.home/'.env').write_text('CONTEXT7_API_KEY=local\nTAVILY_API_KEY=local\n')
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
            installer.ensure_research_tools(self.home)
        self.assertFalse((self.home/installer.TOOLS_DIR).exists())

    def test_dry_run_reports_missing_keys_and_migration_without_io(self):
        self.config('[mcp_servers.codegraph]\ncommand="codegraph-mcp"\n')
        before = snapshot(self.home)
        with patch.dict(os.environ, {}, clear=True):
            self.ensure(dry_run=True)
        self.assertEqual([], self.calls)
        self.assertEqual(before, snapshot(self.home))
        self.assertIn('MISSING', '\n'.join(self.reports))
        self.assertIn('readiness is NOT verified', '\n'.join(self.reports))
        self.assertIn('migrate CodeGraph', '\n'.join(self.reports))

    def test_known_wrong_codegraph_shapes_are_recognized(self):
        commands = ['codegraph-mcp', str(self.home/installer.TOOLS_DIR/'node_modules/.bin/codegraph-mcp')]
        for command in commands:
            self.assertTrue(installer.legacy_codegraph({'command': command}, self.home))
        for version in ('', '@latest'):
            self.assertTrue(installer.legacy_codegraph(
                {'command': 'npx', 'args': ['-y', installer.LEGACY_CODEGRAPH_PACKAGE+version]}, self.home))
        for config in ({'url': 'https://custom.test/mcp', 'command': 'codegraph-mcp'},
                       {'command': '/custom/codegraph-mcp'},
                       {'command': 'codegraph-mcp', 'args': ['--custom']},
                       {'command': 'codegraph', 'args': ['serve', '--mcp']}):
            self.assertFalse(installer.legacy_codegraph(config, self.home))

    def test_upgrade_migrates_legacy_config_without_deleting_old_packages(self):
        prefix = self.home/installer.TOOLS_DIR
        old = fake_package(prefix, installer.LEGACY_CODEGRAPH_PACKAGE, 'codegraph-mcp')
        context7 = fake_package(prefix, '@upstash/context7-mcp', 'context7-mcp')
        tavily = fake_package(prefix, 'tavily-mcp', 'tavily-mcp')
        self.config(f'[mcp_servers.codegraph]\ncommand="{old}"\nstartup_timeout_sec=45\n'
                    f'[mcp_servers.context7]\ncommand="{context7}"\n'
                    f'[mcp_servers.tavily]\ncommand="{tavily}"\n')
        before = snapshot(prefix/'node_modules')
        commands = self.ensure()
        self.assertEqual(['@colbymchenry/codegraph@latest'], [c[-1] for c in self.npm_calls()])
        self.assertEqual(before, snapshot(prefix/'node_modules'))
        cfg = tomllib.loads(installer.merged_config(ROOT, self.home/'config.toml', commands))
        self.assertEqual(['serve', '--mcp'], cfg['mcp_servers']['codegraph']['args'])
        self.assertEqual(45, cfg['mcp_servers']['codegraph']['startup_timeout_sec'])
        self.assertNotEqual(str(old), cfg['mcp_servers']['codegraph']['command'])
        self.assertEqual(str(context7), cfg['mcp_servers']['context7']['command'])

    def test_npx_wrong_package_is_migrated_to_correct_command(self):
        self.config('[mcp_servers.codegraph]\ncommand="npx"\nargs=["-y", "@astudioplus/codegraph-mcp@latest"]\n')
        commands = self.ensure()
        cfg = tomllib.loads(installer.merged_config(ROOT, self.home/'config.toml', commands))
        self.assertEqual(['serve', '--mcp'], cfg['mcp_servers']['codegraph']['args'])
        self.assertEqual(commands['codegraph'], cfg['mcp_servers']['codegraph']['command'])

    def test_custom_server_not_probed_or_replaced(self):
        original = {'command': '/custom/codegraph', 'args': ['serve', '--mcp', '--root', '/project'],
                    'startup_timeout_sec': 90}
        self.config('[mcp_servers.codegraph]\ncommand="/custom/codegraph"\n'
                    'args=["serve", "--mcp", "--root", "/project"]\nstartup_timeout_sec=90\n')
        commands = self.ensure()
        self.assertNotIn('codegraph', commands)
        cfg = tomllib.loads(installer.merged_config(ROOT, self.home/'config.toml', commands))
        self.assertEqual(original, cfg['mcp_servers']['codegraph'])
        self.assertIn('custom; not probed', '\n'.join(self.reports))

    def test_disabled_server_is_preserved_and_not_reenabled(self):
        self.config('[mcp_servers.codegraph]\ncommand="codegraph-mcp"\nenabled=false\n')
        commands = self.ensure()
        cfg = tomllib.loads(installer.merged_config(ROOT, self.home/'config.toml', commands))
        self.assertNotIn('codegraph', commands)
        self.assertFalse(cfg['mcp_servers']['codegraph']['enabled'])
        self.assertEqual('codegraph-mcp', cfg['mcp_servers']['codegraph']['command'])

    def test_uninstalled_managed_config_does_not_count_as_installed(self):
        missing = self.home/installer.TOOLS_DIR/'context7/node_modules/.bin/context7-mcp'
        self.config(f'[mcp_servers.context7]\ncommand="{missing}"\n')
        commands = self.ensure()
        self.assertTrue(Path(commands['context7']).is_file())
        self.assertIn('@upstash/context7-mcp@latest', [c[-1] for c in self.npm_calls()])

    def test_wrong_package_under_codegraph_filename_is_not_reused(self):
        fake_package(self.home/installer.TOOLS_DIR/'codegraph', 'some-other-codegraph', 'codegraph')
        commands = self.ensure()
        self.assertIn('@colbymchenry/codegraph@latest', [c[-1] for c in self.npm_calls()])
        self.assertTrue(installer.research_executable(Path(commands['codegraph']), '@colbymchenry/codegraph', managed=True))

    def test_correct_codegraph_on_path_is_reused(self):
        binary = fake_package(self.tmp/'external', '@colbymchenry/codegraph', 'codegraph')
        which = self.which
        with patch.object(self, 'which', side_effect=lambda name: str(binary) if name == 'codegraph' else which(name)):
            commands = self.ensure()
        self.assertEqual(str(binary), commands['codegraph'])
        self.assertNotIn('@colbymchenry/codegraph@latest', [c[-1] for c in self.npm_calls()])

    def test_existing_stdio_env_forwarding_is_extended_without_copying_keys(self):
        original = ('[mcp_servers.context7]\ncommand="npx"\nargs=["-y", "@upstash/context7-mcp"]\n'
                    'env_vars=["OTHER"]\nstartup_timeout_sec=60\n'
                    '[mcp_servers.tavily]\ncommand="tavily-mcp"\nenv_vars=["TAVILY_API_KEY", "EXTRA"]\n')
        merged = installer.merge_config(ROOT, original)
        cfg = tomllib.loads(merged)
        self.assertEqual(['OTHER', 'CONTEXT7_API_KEY'], cfg['mcp_servers']['context7']['env_vars'])
        self.assertEqual(['-y', '@upstash/context7-mcp'], cfg['mcp_servers']['context7']['args'])
        self.assertEqual(['TAVILY_API_KEY', 'EXTRA'], cfg['mcp_servers']['tavily']['env_vars'])
        self.assertEqual(60, cfg['mcp_servers']['context7']['startup_timeout_sec'])
        self.assertEqual(merged, installer.merge_config(ROOT, merged))
        for value in KEYS.values():
            self.assertNotIn(value, merged)

    def test_remote_mcp_auth_and_custom_env_sources_are_preserved(self):
        original = ('[mcp_servers.context7]\nurl="https://custom.test/mcp"\n'
                    'bearer_token_env_var="CUSTOM_TOKEN"\n'
                    '[mcp_servers.tavily]\ncommand="/custom/server"\n'
                    'env_vars=[{name="TAVILY_API_KEY", source="remote"}]\n')
        cfg = tomllib.loads(installer.merge_config(ROOT, original))
        before = tomllib.loads(original)
        for name in ('context7', 'tavily'):
            self.assertEqual(before['mcp_servers'][name], cfg['mcp_servers'][name])

    def test_fresh_config_keeps_codegraph_serve_args_with_absolute_command(self):
        cfg = tomllib.loads(installer.merge_config(ROOT, '', tool_commands={'codegraph': '/managed/codegraph'}))
        self.assertEqual(['serve', '--mcp'], cfg['mcp_servers']['codegraph']['args'])
        self.assertEqual('/managed/codegraph', cfg['mcp_servers']['codegraph']['command'])

    def test_skip_tools_keeps_legacy_command_until_actual_repair(self):
        original = '[mcp_servers.codegraph]\ncommand="codegraph-mcp"\n'
        cfg = tomllib.loads(installer.merge_config(ROOT, original))
        self.assertEqual('codegraph-mcp', cfg['mcp_servers']['codegraph']['command'])

    def test_malformed_env_forwarding_is_not_silently_replaced(self):
        with self.assertRaises(ValueError):
            installer.merge_config(ROOT, '[mcp_servers.context7]\ncommand="npx"\nenv_vars="wrong"\n')

    def test_npm_failure_redacts_output_and_preserves_old_config(self):
        self.config('[mcp_servers.codegraph]\ncommand="codegraph-mcp"\n')
        before = (self.home/'config.toml').read_bytes()
        run = self.fake_run
        def failure(command, **kwargs):
            if command[0] == '/fixture/node':
                return run(command, **kwargs)
            return subprocess.CompletedProcess(command, 1, KEYS['TAVILY_API_KEY'], KEYS['CONTEXT7_API_KEY'])
        with patch.object(self, 'fake_run', side_effect=failure):
            with self.assertRaises(ValueError) as error:
                self.ensure()
        for value in KEYS.values():
            self.assertNotIn(value, str(error.exception)+'\n'.join(self.reports))
        self.assertEqual(before, (self.home/'config.toml').read_bytes())
        self.assertFalse((self.home/installer.TOOLS_DIR/'codegraph').exists())

    def test_timeout_does_not_echo_subprocess_environment(self):
        with patch.object(self, 'fake_run', side_effect=subprocess.TimeoutExpired('sensitive', 15, output=KEYS['TAVILY_API_KEY'])):
            with self.assertRaises(ValueError) as error:
                self.ensure()
        self.assertNotIn(KEYS['TAVILY_API_KEY'], str(error.exception))

    def test_npm_packages_never_receive_service_api_keys(self):
        self.ensure()  # run() asserts both Node and npm receive no service keys
        self.assertEqual(3, len(self.npm_calls()))
        for key, value in KEYS.items():
            self.assertEqual(value, os.environ[key])

    def test_symlink_install_destination_is_rejected_before_npm(self):
        outside = self.tmp/'outside'; outside.mkdir()
        prefix = self.home/installer.TOOLS_DIR; prefix.mkdir(parents=True)
        (prefix/'codegraph').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.ensure()
        self.assertEqual([], self.calls)
        self.assertEqual([], list(outside.iterdir()))

    def test_missing_keys_stop_full_install_before_staging(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(installer, 'build_stage') as stage, \
             patch.object(installer.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'CONTEXT7_API_KEY'):
                installer.install(ROOT, self.home, install_tools=True, validate=False)
        stage.assert_not_called(); run.assert_not_called()
        self.assertFalse(self.home.exists())

    def test_skip_tools_cli_still_reports_missing_keys_without_installing(self):
        env = {k: v for k, v in os.environ.items() if k not in KEYS}
        result = subprocess.run([sys.executable, str(ROOT/'scripts/install.py'), '--skip-tools',
                                 '--codex-home', str(self.home)], env=env, text=True, capture_output=True)
        self.assertEqual(0, result.returncode, result.stderr)
        for key in KEYS:
            self.assertIn(f'ENV {key}: MISSING', result.stdout)
        self.assertIn('readiness is NOT verified', result.stdout)
        self.assertFalse((self.home/installer.TOOLS_DIR).exists())
        self.assertTrue((self.home/'config.toml').is_file())


if __name__ == '__main__':
    unittest.main()
