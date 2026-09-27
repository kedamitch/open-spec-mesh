"""Real Claude Code CLI smoke for generated Open Spec Mesh runtime; no model calls."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "sdd-do" / "scripts"))
import install
import run_leaf


def run(command, *, cwd, env):
    result = subprocess.run(
        command, cwd=cwd, env=env, text=True, capture_output=True, timeout=60
    )
    if result.returncode:
        raise SystemExit(
            "Claude Code smoke failed: "
            + " ".join(command[:4])
            + "\n"
            + (result.stderr or result.stdout)[-4000:]
        )
    return result.stdout + result.stderr


def main():
    binary = shutil.which("claude")
    if not binary:
        raise SystemExit("Claude Code CLI missing; runtime smoke did not run")
    version = run([binary, "--version"], cwd=ROOT, env=os.environ.copy()).strip()
    print("Claude Code:", version)

    with tempfile.TemporaryDirectory(prefix="open-spec-mesh-claude-") as tmp:
        base = Path(tmp)
        home = base / "claude"
        project = base / "project"
        user_home = base / "user"
        project.mkdir()
        user_home.mkdir()
        subprocess.run(["git", "init", "-q", str(project)], check=True)

        install.install_host(
            ROOT, "claude", home, validate=False, install_tools=False,
            reporter=lambda _: None,
        )

        env = os.environ.copy()
        env.update({
            "HOME": str(user_home),
            "CLAUDE_CONFIG_DIR": str(home),
            "DISABLE_AUTOUPDATER": "1",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        })

        help_text = run([binary, "--help"], cwd=project, env=env)
        for flag in ("--agent", "--resume", "--mcp-config", "--output-format", "--verbose"):
            if flag not in help_text:
                raise SystemExit("Claude Code flag missing: " + flag)

        # Claude documents plugin validate as the parser/checker for agent dirs.
        run([binary, "plugin", "validate", str(home / "agents")], cwd=project, env=env)

        main_agent = (home / "agents" / "main.md").read_text(encoding="utf-8")
        architect = (home / "agents" / "architect.md").read_text(encoding="utf-8")
        worker = (home / "agents" / "worker.md").read_text(encoding="utf-8")
        if "Agent(architect, worker, reviewer, explorer, librarian)" not in main_agent:
            raise SystemExit("Claude Main delegation allowlist missing")
        if "Agent(explorer, librarian)" not in architect:
            raise SystemExit("Claude Architect delegation allowlist missing")
        if "Agent(" in worker:
            raise SystemExit("Claude Worker must not receive Agent delegation")
        if "model: inherit" not in worker or "gpt-6-" in worker:
            raise SystemExit("Claude role must inherit the user's host model")

        mcp = json.loads((home / "open-spec-mesh.mcp.json").read_text(encoding="utf-8"))
        if set(("codegraph", "context7", "tavily")) - set(mcp.get("mcpServers", {})):
            raise SystemExit("Claude MCP overlay incomplete")

        args, extra_env = run_leaf.host_command(
            "claude", binary, "worker", project, "session-123456", home
        )
        for flag in ("--agent", "--resume", "--mcp-config", "--output-format", "--verbose"):
            if flag not in args:
                raise SystemExit("Claude launcher missing flag: " + flag)
        if extra_env:
            raise SystemExit("Claude launcher should not inject provider/model environment")
        if "worktree" in " ".join(args).lower():
            raise SystemExit("Claude launcher must not create a second worktree")

        print("Claude native agent/launcher smoke passed without a model call.")


if __name__ == "__main__":
    main()
