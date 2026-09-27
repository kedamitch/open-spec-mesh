"""Real Claude Code CLI/config smoke without model/provider calls."""
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
import install


def run(args, *, env, cwd=ROOT):
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise SystemExit(
            f"command failed ({result.returncode}): {' '.join(args)}\n"
            + (result.stderr or result.stdout)[-4000:]
        )
    return result.stdout + result.stderr


def main():
    binary = shutil.which("claude")
    if not binary:
        raise SystemExit("Claude Code CLI missing; runtime validation did not run")
    version = run([binary, "--version"], env=os.environ.copy()).strip()
    print("Claude Code", version)

    with tempfile.TemporaryDirectory(prefix="open-spec-mesh-claude-") as tmp:
        base = Path(tmp)
        home = base / "claude"
        project = base / "project"
        project.mkdir()
        subprocess.run(["git", "init", "-q", str(project)], check=True)
        install.install_host(
            ROOT, "claude", home, validate=False, install_tools=False,
            reporter=lambda _: None,
        )
        env = os.environ.copy()
        env.update({
            "HOME": str(base / "fake-home"),
            "CLAUDE_CONFIG_DIR": str(home),
        })

        help_text = run([binary, "--help"], env=env, cwd=project)
        for flag in ("--agent", "--resume", "--mcp-config"):
            if flag not in help_text:
                raise SystemExit("Claude Code help missing required flag: " + flag)
        # Exercise the native --agent parser without making a model request.
        agent_help = run([binary, "--agent", "main", "--help"], env=env, cwd=project)
        if "--agent" not in agent_help:
            raise SystemExit("Claude Code did not accept --agent main")

        main_agent = (home / "agents" / "main.md").read_text()
        architect = (home / "agents" / "architect.md").read_text()
        worker = (home / "agents" / "worker.md").read_text()
        if "model: inherit" not in main_agent:
            raise SystemExit("Claude Main must inherit the host model")
        if "Agent(architect, worker, reviewer, explorer, librarian)" not in main_agent:
            raise SystemExit("Claude Main delegation allowlist missing")
        if "Agent(explorer, librarian)" not in architect:
            raise SystemExit("Claude Architect delegation allowlist missing")
        if "tools: Agent" in worker:
            raise SystemExit("Claude Worker must not receive Agent tool")
        for text in (main_agent, architect, worker):
            if "gpt-6-" in text or "$CODEX_HOME" in text:
                raise SystemExit("Claude agent leaked Codex-specific routing")

        overlay = json.loads((home / "open-spec-mesh.mcp.json").read_text())
        if set(overlay["mcpServers"]) != {"codegraph", "context7", "tavily"}:
            raise SystemExit("Claude MCP overlay mismatch")
        if overlay["mcpServers"]["context7"]["env"]["CONTEXT7_API_KEY"] != "${CONTEXT7_API_KEY}":
            raise SystemExit("Claude MCP config must reference, not copy, credentials")
        print("Claude Code host adapter smoke passed; no model request was made.")


if __name__ == "__main__":
    main()
