"""Real OpenCode CLI smoke without model/provider calls."""
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
    binary = shutil.which("opencode")
    if not binary:
        raise SystemExit("OpenCode CLI missing; runtime validation did not run")
    version = run([binary, "--version"], env=os.environ.copy()).strip()
    print("OpenCode", version)

    with tempfile.TemporaryDirectory(prefix="open-spec-mesh-opencode-") as tmp:
        base = Path(tmp)
        home = base / "config"
        project = base / "project"
        project.mkdir()
        subprocess.run(["git", "init", "-q", str(project)], check=True)
        install.install_host(
            ROOT, "opencode", home, validate=False, install_tools=False,
            reporter=lambda _: None,
        )
        env = os.environ.copy()
        env.update({
            "HOME": str(base / "fake-home"),
            "OPENCODE_CONFIG_DIR": str(home),
            "OPENCODE_CONFIG": str(home / "open-spec-mesh.opencode.json"),
            "OPENCODE_DISABLE_AUTOUPDATE": "1",
        })

        help_text = run([binary, "run", "--help"], env=env, cwd=project)
        print(help_text)
        for flag in ("--agent", "--format", "--session"):
            if flag not in help_text:
                raise SystemExit("OpenCode run help missing required flag: " + flag)

        config_text = run([binary, "debug", "config"], env=env, cwd=project)
        agents_text = run([binary, "debug", "agents"], env=env, cwd=project)
        for name in ("main", "architect", "worker", "reviewer", "explorer", "librarian"):
            if name not in agents_text:
                raise SystemExit("OpenCode did not discover installed agent: " + name)
        if "main" not in config_text or "default_agent" not in config_text:
            raise SystemExit("OpenCode did not load Open Spec Mesh custom config/default agent")

        overlay = json.loads((home / "open-spec-mesh.opencode.json").read_text())
        if overlay.get("default_agent") != "main":
            raise SystemExit("OpenCode overlay default_agent mismatch")
        if set(overlay["mcp"]["servers"]) != {"codegraph", "context7", "tavily"}:
            raise SystemExit("OpenCode MCP overlay mismatch")
        worker = (home / "agents" / "worker.md").read_text()
        architect = (home / "agents" / "architect.md").read_text()
        if "action: subagent" not in worker or "effect: deny" not in worker:
            raise SystemExit("OpenCode Worker subagent deny missing")
        if "resource: explorer" not in architect or "resource: librarian" not in architect:
            raise SystemExit("OpenCode Architect delegation allowlist missing")
        if "gpt-6-" in worker or "gpt-6-" in architect:
            raise SystemExit("Non-Codex agent leaked Codex model routing")
        print("OpenCode host adapter smoke passed; no model request was made.")


if __name__ == "__main__":
    main()
