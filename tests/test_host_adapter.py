from pathlib import Path
import json
import tempfile
import unittest

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import host_adapter


class HostAdapterTests(unittest.TestCase):
    def test_default_homes_and_capabilities(self):
        env = {"HOME": "/home/test"}
        self.assertEqual(Path("/home/test/.codex"), host_adapter.default_home("codex", env))
        self.assertEqual(Path("/home/test/.config/opencode"), host_adapter.default_home("opencode", env))
        self.assertEqual(Path("/home/test/.claude"), host_adapter.default_home("claude", env))
        self.assertTrue(host_adapter.host_profile("codex", "/tmp/c").native_trace)
        self.assertFalse(host_adapter.host_profile("opencode", "/tmp/o").native_trace)
        self.assertFalse(host_adapter.host_profile("claude", "/tmp/a").native_trace)
        with self.assertRaises(ValueError):
            host_adapter.host_profile("unknown")

    def test_opencode_roles_are_native_and_keep_delegation_boundaries(self):
        home = Path("/tmp/opencode-home")
        main = host_adapter.render_main(ROOT, "opencode", home)
        architect = host_adapter.render_role(ROOT, "opencode", "architect", home)
        worker = host_adapter.render_role(ROOT, "opencode", "worker", home)
        self.assertIn("mode: primary", main)
        self.assertIn("architect: allow", main)
        self.assertIn("mode: subagent", architect)
        self.assertIn("explorer: allow", architect)
        self.assertIn("librarian: allow", architect)
        self.assertNotIn("worker: allow", architect)
        self.assertIn('"*": deny', worker)
        self.assertIn("edit: deny", host_adapter.render_role(ROOT, "opencode", "reviewer", home))
        for text in (main, architect, worker):
            self.assertNotIn("$CODEX_HOME", text)
            self.assertNotIn("gpt-6-", text)

    def test_claude_roles_inherit_model_and_leaf_roles_cannot_delegate(self):
        home = Path("/tmp/claude-home")
        main = host_adapter.render_main(ROOT, "claude", home)
        architect = host_adapter.render_role(ROOT, "claude", "architect", home)
        self.assertIn("Agent(architect, worker, reviewer, explorer, librarian)", main)
        self.assertIn("tools: Agent,", architect)
        for role in host_adapter.LEAF_ROLES:
            text = host_adapter.render_role(ROOT, "claude", role, home)
            self.assertIn("model: inherit", text)
            self.assertNotIn("tools: Agent", text)
            self.assertNotIn("$CODEX_HOME", text)
            self.assertNotIn("gpt-6-", text)

    def test_rules_and_dispatch_paths_are_host_specific(self):
        open_home = Path("/tmp/open")
        claude_home = Path("/tmp/claude")
        self.assertIn(str(open_home / "skills"), host_adapter.render_rules(ROOT, "opencode", open_home))
        self.assertIn("# Open Spec Mesh", host_adapter.render_rules(ROOT, "claude", claude_home))
        dispatch = host_adapter.render_role(ROOT, "claude", "architect", claude_home)
        self.assertIn(str(claude_home / "open-spec-mesh" / "dispatch-contract.md"), dispatch)

    def test_mcp_overlays_use_env_references_without_secret_values(self):
        commands = {
            "codegraph": "/tools/codegraph",
            "context7": "/tools/context7-mcp",
            "tavily": "/tools/tavily-mcp",
        }
        opencode = json.loads(host_adapter.render_mcp_overlay("opencode", commands))
        servers = opencode["mcp"]["servers"]
        self.assertEqual(["/tools/codegraph", "serve", "--mcp"], servers["codegraph"]["command"])
        self.assertEqual("{env:CONTEXT7_API_KEY}", servers["context7"]["environment"]["CONTEXT7_API_KEY"])
        claude = json.loads(host_adapter.render_mcp_overlay("claude", commands))
        self.assertEqual("${TAVILY_API_KEY}", claude["mcpServers"]["tavily"]["env"]["TAVILY_API_KEY"])
        rendered = json.dumps({"opencode": opencode, "claude": claude})
        self.assertNotIn("ci-secret", rendered)

    def test_native_artifact_paths_do_not_share_host_layouts(self):
        open_paths = host_adapter.native_artifact_paths("opencode", "/tmp/o")
        claude_paths = host_adapter.native_artifact_paths("claude", "/tmp/c")
        self.assertEqual(Path("/tmp/o/AGENTS.md"), open_paths["rules"])
        self.assertEqual(Path("/tmp/c/CLAUDE.md"), claude_paths["rules"])
        self.assertEqual(Path("/tmp/o/agents"), open_paths["agents"])
        self.assertEqual(Path("/tmp/c/agents"), claude_paths["agents"])


if __name__ == "__main__":
    unittest.main()
