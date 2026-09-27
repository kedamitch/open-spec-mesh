"""Run/resume an isolated Open Spec Mesh leaf role on a supported host.

Codex keeps its strict separate-process fallback. OpenCode and Claude Code use
their native named-agent/session CLI while staying inside the exact SDD
workspace prepared by Main. This launcher never creates another worktree and
never chooses a provider/model for non-Codex hosts.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib
import uuid

HOSTS = ("auto", "codex", "opencode", "claude")
LEAVES = ("worker", "reviewer", "explorer", "librarian")


def role_path(role):
    if role not in LEAVES:
        raise ValueError("Only leaf roles are permitted")
    package = Path(__file__).resolve().parents[2]
    for root in (package, package.parent):
        path = root / "agents" / (role + ".toml")
        if path.is_file():
            return path
    raise ValueError("Installed role file missing")


def command(binary, role_file, project, resume=None):
    """Backward-compatible Codex command builder."""
    data = tomllib.loads(Path(role_file).read_text(encoding="utf-8"))
    if data.get("name") not in LEAVES:
        raise ValueError("Architect/Main cannot use the leaf launcher")
    project = Path(project).resolve()
    if not project.is_dir():
        raise ValueError("Project directory missing")
    if resume:
        uuid.UUID(resume)
    overrides = {
        key: data[key]
        for key in ("model", "model_reasoning_effort", "developer_instructions", "sandbox_mode")
    }
    overrides.update(
        {"agents.enabled": False, "features.multi_agent": False, "features.multi_agent_v2": False}
    )
    args = [binary, "-C", str(project)]
    for key, value in overrides.items():
        args += ["-c", key + "=" + json.dumps(value, ensure_ascii=False)]
    args += ["exec"]
    if resume:
        args += ["resume", resume]
    args += ["--json", "--skip-git-repo-check", "-"]
    return args


def default_home(host):
    home = Path.home()
    if host == "codex":
        return Path(os.environ.get("CODEX_HOME", home / ".codex")).expanduser()
    if host == "opencode":
        return Path(
            os.environ.get("OPENCODE_CONFIG_DIR", home / ".config" / "opencode")
        ).expanduser()
    if host == "claude":
        return Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude")).expanduser()
    raise ValueError("Unknown host: " + host)


def resolve_host(host):
    if host != "auto":
        return host
    explicit = os.environ.get("OPEN_SPEC_MESH_HOST", "").strip().lower()
    if explicit:
        if explicit not in HOSTS[1:]:
            raise ValueError("Invalid OPEN_SPEC_MESH_HOST")
        return explicit
    # Preserve historical behavior when Codex exists. Otherwise pick the first
    # installed supported CLI; never silently pick between multiple alternatives.
    if shutil.which("codex"):
        return "codex"
    available = [name for name in ("opencode", "claude") if shutil.which(name)]
    if len(available) == 1:
        return available[0]
    if not available:
        raise ValueError("No supported host CLI installed")
    raise ValueError("Multiple host CLIs installed; use --host")


def _session_id(host, value):
    if not value:
        return None
    if host == "codex":
        uuid.UUID(value)
        return value
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{5,255}", value):
        raise ValueError("Invalid session id")
    return value


def host_command(host, binary, role, project, resume=None, home=None):
    """Build a host-native leaf command without changing the SDD workspace."""
    if role not in LEAVES:
        raise ValueError("Only leaf roles are permitted")
    project = Path(project).resolve()
    if not project.is_dir():
        raise ValueError("Project directory missing")
    resume = _session_id(host, resume)
    home = Path(home).expanduser() if home is not None else default_home(host)

    if host == "codex":
        return command(binary, role_path(role), project, resume), {}

    if host == "opencode":
        args = [
            binary,
            "run",
            "--agent",
            role,
            "--format",
            "json",
            "--dir",
            str(project),
        ]
        if resume:
            args += ["--session", resume]
        env = {
            "OPENCODE_CONFIG_DIR": str(home),
            "OPENCODE_CONFIG": str(home / "open-spec-mesh.opencode.json"),
        }
        return args, env

    if host == "claude":
        args = [
            binary,
            "-p",
            "--agent",
            role,
            "--output-format",
            "stream-json",
            "--verbose",
            "--mcp-config",
            str(home / "open-spec-mesh.mcp.json"),
        ]
        if resume:
            args += ["--resume", resume]
        return args, {}

    raise ValueError("Unknown host: " + host)


def executable(host):
    binary = shutil.which(host)
    if not binary:
        raise ValueError(host + " CLI not installed")
    return binary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=LEAVES)
    parser.add_argument("--host", choices=HOSTS, default="auto")
    parser.add_argument("--host-home", type=Path)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--prompt-file", type=Path, required=True)
    parser.add_argument("--resume", help="Exact prior host session ID; use the same role/worktree")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    try:
        host = resolve_host(args.host)
        binary = executable(host)
        if args.timeout < 1:
            raise ValueError("Timeout must be positive")
        text = args.prompt_file.read_text(encoding="utf-8")
        if not text.strip():
            raise ValueError("Task prompt is empty")
        cmd, extra_env = host_command(
            host, binary, args.role, args.root, args.resume, args.host_home
        )
        env = os.environ.copy()
        env.update(extra_env)
        if host == "codex":
            result = subprocess.run(
                cmd, input=text, text=True, timeout=args.timeout, cwd=args.root, env=env
            )
        else:
            result = subprocess.run(
                [*cmd, text], text=True, timeout=args.timeout, cwd=args.root, env=env
            )
        raise SystemExit(result.returncode)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
