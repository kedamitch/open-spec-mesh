"""Runtime-only installation, legacy-doc preservation and shared writing references."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_install import installer, snapshot
import test_sdd as fixture

ROOT = Path(__file__).resolve().parents[1]


class RuntimeInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sdd-runtime-install-')
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)/'home'

    def install(self, **kwargs):
        return installer.install(ROOT, self.home, validate=False, **kwargs)

    def test_default_is_runtime_only_with_separate_compatibility_shims(self):
        self.install()
        self.assertFalse((self.home/'docs').exists())
        self.assertEqual(8, len(installer.CORE_SKILLS))
        self.assertEqual({'prd-spec', 'design-overview'}, set(installer.COMPAT_SKILLS))
        for name in installer.SKILLS:
            self.assertTrue((self.home/'skills'/name/'SKILL.md').is_file())
        self.assertLess(len((self.home/'README.md').read_text()), 1000)
        self.assertNotIn('(docs/index.md)', (self.home/'index.md').read_text())
        self.assertNotIn(Path('docs'), installer.package_paths())
        self.assertIn(Path('docs'), installer.package_paths(True))

    def test_legacy_docs_are_preserved_byte_for_byte_on_default_upgrade(self):
        self.install(include_project_docs=True)
        (self.home/'docs/user-note.md').write_text('do not delete or rewrite')
        before = snapshot(self.home/'docs')
        self.install()
        self.install(dry_run=True)
        self.assertEqual(before, snapshot(self.home/'docs'))
        self.assertNotIn('(docs/index.md)', (self.home/'index.md').read_text())

    def test_opt_in_includes_reference_docs_and_navigation(self):
        self.install(include_project_docs=True)
        self.assertTrue((self.home/'docs/index.md').is_file())
        self.assertIn('(docs/index.md)', (self.home/'index.md').read_text())

    def test_default_preserves_user_docs_symlink_but_opt_in_rejects_it(self):
        self.home.mkdir()
        outside = Path(self.tmp.name)/'user-docs'; outside.mkdir()
        (outside/'keep.md').write_text('keep')
        (self.home/'docs').symlink_to(outside, target_is_directory=True)
        self.install()
        self.assertTrue((self.home/'docs').is_symlink())
        with self.assertRaises(ValueError):
            self.install(include_project_docs=True)
        self.assertEqual('keep', (outside/'keep.md').read_text())

    def test_runtime_install_failure_restores_files_and_leaves_user_docs_untouched(self):
        self.install()
        (self.home/'docs').mkdir(); (self.home/'docs/keep.md').write_text('user document')
        before = snapshot(self.home)
        original = installer.os.replace
        def fail(source, destination):
            if Path(destination) == self.home/'skills/sdd-do' and '.sdd-do.' in str(source):
                raise OSError('injected runtime replacement failure')
            return original(source, destination)
        with patch.object(installer.os, 'replace', side_effect=fail):
            with self.assertRaises(OSError):
                self.install()
        self.assertEqual(before, snapshot(self.home))

    def test_runtime_dry_run_does_not_create_target(self):
        self.install(dry_run=True)
        self.assertFalse(self.home.exists())

    def test_runtime_navigation_and_shared_guides_have_resolvable_links(self):
        self.install()
        paths = [self.home/'README.md', self.home/'index.md', self.home/'agents/index.md']
        paths += [self.home/'skills/sdd-init/references'/name for name in
                  ('runtime-guide.md', 'product-writing.md', 'architecture-writing.md')]
        paths += [self.home/'skills'/name/'SKILL.md' for name in installer.COMPAT_SKILLS]
        for path in paths:
            for link in re.findall(r'\]\(([^)]+)\)', path.read_text()):
                if '://' in link or link.startswith('#'):
                    continue
                target = (path.parent/link.split('#')[0]).resolve()
                self.assertTrue(target.exists(), f'{path}: {link}')

    def test_installed_cli_operates_without_installed_package_docs(self):
        self.install()
        f = fixture.LifecycleTest(); f.setUp(); self.addCleanup(f.doCleanups)
        command = self.home/'skills/sdd-change/scripts/sdd.py'
        task = f.task()
        result = subprocess.run([sys.executable, str(command), 'prepare', f.change.name, '--root', str(f.root),
                                 '--task', task], text=True, capture_output=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual('running', json.loads(result.stdout)['state'])
        self.assertFalse((self.home/'docs').exists())

    def test_shared_references_keep_required_product_and_technical_semantics(self):
        product = (ROOT/'sdd-init/references/product-writing.md').read_text()
        architecture = (ROOT/'sdd-init/references/architecture-writing.md').read_text()
        for value in ('产品架构', '模块', '核心能力', '权限', '失败', '产品定位与边界'):
            self.assertIn(value, product)
        for value in ('API', 'Schema', 'Domain Model', 'stateDiagram-v2', 'sequenceDiagram', '幂等', '失败 / 恢复'):
            self.assertIn(value, architecture)
        for path in ('prd-spec/references/product-template.md', 'design-overview/references/architecture-template.md'):
            self.assertLess(len((ROOT/path).read_text()), 400)


if __name__ == '__main__':
    unittest.main()
