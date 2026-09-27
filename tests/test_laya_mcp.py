"""Laya HTTP MCP bridge and installer integration tests."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from test_install import installer
import laya_runtime as runtime_http
from laya_contracts import config as bridge_config, provider_config

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("laya_http_mcp", ROOT/"mcp/laya_http_mcp.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

RESEARCH_ENV = {
    "CONTEXT7_API_KEY": "test-context7",
    "TAVILY_API_KEY": "test-tavily",
}
LAYA_ENV = {
    "LAYA_BASE_URL": "http://127.0.0.1:8000/",
    "LAYA_API_KEY": "test-laya-secret",
}
JEV_ENV = {
    "SYSTEMONE_PROVIDER": "jev",
    "TYPESAFE_API_KEY": "test-jev-secret",
    "TYPESAFE_BASE_URL": "http://127.0.0.1:8000/",
}


class Response:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def read(self, limit=None):
        return json.dumps(self.payload).encode()


class LayaInstallerTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="sdd-laya-mcp-")
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name)/"home"

    def test_default_install_keeps_all_systemone_surfaces_off(self):
        with patch.dict(os.environ, {"TYPESAFE_API_KEY":"stray-jev-key"}, clear=True), \
             patch.object(installer, "check_laya_env") as check, \
             patch.object(installer, "ensure_laya_mcp") as ensure:
            installer.install(ROOT, self.home, install_tools=False, validate=False)
        check.assert_not_called()
        ensure.assert_not_called()
        self.assertFalse((self.home/"skills/typesafe-laya").exists())
        self.assertFalse(json.loads((self.home/"mcp/laya-settings.json").read_text())["enabled"])
        cfg = tomllib.loads((self.home/"config.toml").read_text())
        self.assertNotIn("laya", cfg.get("mcp_servers", {}))
        self.assertNotIn("typesafe-laya", (self.home/"index.md").read_text())

    def test_laya_env_names_only_and_url_validation(self):
        reports = []
        with patch.dict(os.environ, LAYA_ENV, clear=True):
            self.assertEqual([], installer.check_laya_env(reporter=reports.append))
        output = "\n".join(reports)
        for name, value in LAYA_ENV.items():
            self.assertIn(name, output)
            self.assertNotIn(value, output)
        with patch.dict(os.environ, {"LAYA_BASE_URL": "not-a-url", "LAYA_API_KEY": "x"}, clear=True):
            with self.assertRaisesRegex(ValueError, "absolute http"):
                installer.check_laya_env()

    def test_jev_is_disabled_by_default_and_requires_explicit_provider(self):
        with patch.dict(os.environ, {"TYPESAFE_API_KEY":"test-jev-secret"}, clear=True):
            self.assertEqual('laya', provider_config.__globals__['resolve_provider']())
            with self.assertRaisesRegex(ValueError, "LAYA_BASE_URL"):
                provider_config()
        reports = []
        with patch.dict(os.environ, {"SYSTEMONE_PROVIDER":"jev","TYPESAFE_API_KEY":"test-jev-secret"}, clear=True):
            self.assertEqual([], installer.check_laya_env(reporter=reports.append))
            cfg = provider_config()
        self.assertEqual('jev', cfg['provider'])
        self.assertEqual('https://api.typesafe.ai', cfg['base'])
        self.assertEqual('jev-latest', cfg['model'])
        self.assertEqual(10.0, cfg['timeout'])
        self.assertIn('TYPESAFE_API_KEY', '\n'.join(reports))
        self.assertNotIn('test-jev-secret', '\n'.join(reports))

    def test_full_install_stops_on_missing_laya_env_before_tool_install(self):
        env = dict(RESEARCH_ENV)
        with patch.dict(os.environ, env, clear=True), \
             patch.object(installer, "ensure_research_tools") as research, \
             patch.object(installer, "ensure_laya_mcp") as laya:
            with self.assertRaisesRegex(ValueError, "LAYA_BASE_URL"):
                installer.install(ROOT, self.home, install_tools=True, validate=False, with_laya=True)
        research.assert_not_called()
        laya.assert_not_called()
        self.assertFalse(self.home.exists())

    def test_skip_tools_copies_bridge_and_configures_env_forwarding(self):
        with patch.dict(os.environ, {}, clear=True):
            installer.install(ROOT, self.home, install_tools=False, validate=False, with_laya=True)
        cfg = tomllib.loads((self.home/"config.toml").read_text())
        laya = cfg["mcp_servers"]["laya"]
        self.assertEqual(sys.executable, laya["command"])
        self.assertEqual([str(self.home/"mcp/laya_http_mcp.py")], laya["args"])
        self.assertEqual(list(installer.FORWARDED_ENV), laya["env_vars"])
        self.assertTrue((self.home/"mcp/laya_http_mcp.py").is_file())
        self.assertFalse((self.home/installer.TOOLS_DIR).exists())

    def test_custom_laya_server_is_preserved_and_not_managed(self):
        self.home.mkdir()
        (self.home/"config.toml").write_text(
            '[mcp_servers.laya]\nurl="https://example.test/mcp"\n'
        )
        reports = []
        self.assertFalse(installer.laya_server_managed(self.home, reports.append))
        self.assertIn("custom; not probed", "\n".join(reports))

    def test_laya_runtime_install_is_isolated_and_redacts_service_env(self):
        calls = []
        def fake_run(command, **kwargs):
            calls.append((command, kwargs))
            self.assertNotIn("LAYA_BASE_URL", kwargs["env"])
            self.assertNotIn("LAYA_API_KEY", kwargs["env"])
            target = Path(command[command.index("--target")+1])
            metadata = target/"mcp-2.2.0.dist-info/METADATA"
            metadata.parent.mkdir(parents=True)
            metadata.write_text("Name: mcp\nVersion: 2.2.0\n")
            return subprocess.CompletedProcess(command, 0, "", "")
        with patch.dict(os.environ, LAYA_ENV, clear=False), \
             patch.object(installer.subprocess, "run", side_effect=fake_run):
            launch = installer.ensure_laya_mcp(self.home)
        self.assertEqual(sys.executable, launch["command"])
        self.assertEqual(1, len(calls))
        managed = self.home/installer.TOOLS_DIR/"laya/python"
        self.assertEqual((2, 2, 0), installer.laya_mcp_version(managed))
        with patch.object(installer.subprocess, "run") as run:
            installer.ensure_laya_mcp(self.home)
        run.assert_not_called()


class LayaBridgeTests(unittest.TestCase):
    def test_config_requires_both_variables(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "LAYA_BASE_URL"):
                bridge_config()

    def test_health_request_uses_bearer_without_exposing_key(self):
        seen = {}
        def fake_urlopen(request, timeout):
            seen["authorization"] = request.get_header("Authorization")
            seen["url"] = request.full_url
            seen["timeout"] = timeout
            return Response({"status": "ok"})
        with patch.dict(os.environ, LAYA_ENV, clear=True), patch.object(runtime_http, "build_opener") as opener:
            opener.return_value.open.side_effect = fake_urlopen
            result = runtime_http.http_json("GET", "/health")
        self.assertEqual({"status": "ok"}, result)
        self.assertEqual("Bearer "+LAYA_ENV["LAYA_API_KEY"], seen["authorization"])
        self.assertEqual("http://127.0.0.1:8000/health", seen["url"])

    def test_jev_http_request_uses_typesafe_bearer_and_single_endpoint(self):
        seen = {}
        def fake_urlopen(request, timeout):
            seen["authorization"] = request.get_header("Authorization")
            seen["url"] = request.full_url
            seen["timeout"] = timeout
            return Response({"answers": {}})
        with patch.dict(os.environ, JEV_ENV, clear=True), patch.object(runtime_http, "build_opener") as opener:
            opener.return_value.open.side_effect = fake_urlopen
            result = runtime_http.http_json("POST", "/v1/systemone", {"state": {}, "questions": {}, "model":"jev-latest"})
        self.assertEqual({"answers": {}}, result)
        self.assertEqual("Bearer "+JEV_ENV["TYPESAFE_API_KEY"], seen["authorization"])
        self.assertEqual("http://127.0.0.1:8000/v1/systemone", seen["url"])
        self.assertEqual(10.0, seen["timeout"])

    def test_http_error_never_echoes_api_key(self):
        error = HTTPError(
            "http://127.0.0.1:8000/v1/systemone/batch", 401, "unauthorized", {},
            io.BytesIO(b'{"detail":"invalid bearer"}')
        )
        with patch.dict(os.environ, LAYA_ENV, clear=True), patch.object(runtime_http, "build_opener") as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaisesRegex(runtime_http.ServiceError, "http_401") as caught:
                runtime_http.http_json("POST", "/v1/systemone/batch", {"requests":[{"state": {}, "questions": {}}]})
        self.assertNotIn(LAYA_ENV["LAYA_API_KEY"], str(caught.exception))


if __name__ == "__main__":
    unittest.main()
