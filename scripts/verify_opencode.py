"""Real OpenCode CLI smoke for generated Open Spec Mesh runtime; no model calls."""
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
            "OpenCode smoke failed: "
            + " ".join(command[:4])
            + "\n"
            + (result.stderr or result.stdout)[-4000:]
        )
    return result.stdout


def main():
    binary = shutil.which("opencode")
    if not binary:
        raise SystemExit("OpenCode CLI missing; runtime smoke did not run")
    version = run([binary, "--version"], cwd=ROOT, env=os.environ.copy()).strip()
    print("OpenCode:", version)

    with tempfile.TemporaryDirectory(prefix="open-spec-mesh-opencode-") as tmp:
        base = Path(tmp)
        home = base / "config"
        project = base / "project"
        user_home = base / "user"
        project.mkdir()
        user_home.mkdir()
        subprocess.run(["git", "init", "-q", str(project)], check=True)

        install.install_host(
            ROOT, "opencode", home, validate=False, install_tools=False,
            reporter=lambda _: None,
        )

        env = os.environ.copy()
        env.update({
            "HOME": str(user_home),
            "XDG_CONFIG_HOME": str(base / "xdg"),
            "OPENCODE_CONFIG_DIR": str(home),
            "OPENCODE_CONFIG": str(home / "open-spec-mesh.opencode.json"),
            "OPENCODE_DISABLE_AUTOUPDATE": "1",
        })

        resolved = run([binary, "debug", "config"], cwd=project, env=env)
        sources = json.loads(resolved)
        if not isinstance(sources, list):
            raise SystemExit("OpenCode debug config returned an unexpected shape")
        source_text = json.dumps(sources, ensure_ascii=False)
        overlay_path = str(home / "open-spec-mesh.opencode.json")
        if overlay_path not in source_text and "open-spec-mesh.opencode.json" not in source_text:
            raise SystemExit("OpenCode did not load the Open Spec Mesh config overlay: " + source_text[-2000:])
        overlay = json.loads((home / "open-spec-mesh.opencode.json").read_text())
        if overlay.get("default_agent") != "main":
            raise SystemExit("Open Spec Mesh overlay default_agent mismatch")
        if "model" in overlay:
            raise SystemExit("Open Spec Mesh overlay must not select the user's model")

        agents = run([binary, "agent", "list"], cwd=project, env=env)
        missing = [
            role for role in ("main", "architect", "worker", "reviewer", "explorer", "librarian")
            if role not in agents
        ]
        if missing:
            raise SystemExit(
                "OpenCode agent list did not discover installed agents "
                + ",".join(missing)
                + "\nconfig sources:\n" + resolved[-3000:]
                + "\nagent list:\n" + agents[-5000:]
            )

        help_text = run([binary, "run", "--help"], cwd=project, env=env)
        args, extra_env = run_leaf.host_command(
            "opencode", binary, "worker", project, "ses_123456", home
        )
        for flag in ("--agent", "--format", "--session"):
            if flag not in help_text or flag not in args:
                raise SystemExit("OpenCode run flag mismatch: " + flag)
        # The launcher already runs with cwd=workspace; it must not rely on a
        # host-specific worktree or unsupported directory flag.
        if "--dir" in args or "--directory" in args:
            if "--dir" not in help_text and "--directory" not in help_text:
                raise SystemExit("OpenCode launcher uses an unsupported directory flag")
        if extra_env.get("OPENCODE_CONFIG_DIR") != str(home):
            raise SystemExit("OpenCode launcher lost config directory identity")
        if "worktree" in " ".join(args).lower():
            raise SystemExit("OpenCode launcher must not create a second worktree")

        print("OpenCode native config/agent/launcher smoke passed without a model call.")


if __name__ == "__main__":
    main()
