"""Deterministic host profiles and native runtime renderers.

Canonical SDD semantics stay in AGENTS.md, SKILL.md and agents/*.toml.
This module only maps them into host-native files; it never chooses a
provider/model for OpenCode or Claude Code.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import tomllib

HOSTS = ("codex", "opencode", "claude")
ROLES = ("architect", "worker", "reviewer", "explorer", "librarian")
LEAF_ROLES = ("worker", "reviewer", "explorer", "librarian")


@dataclass(frozen=True)
class HostProfile:
    name: str
    home: Path
    rules_file: str
    skills_dir: str
    agents_dir: str
    cli: str
    native_trace: bool
    mcp_overlay: str | None

    @property
    def rules_path(self) -> Path:
        return self.home / self.rules_file

    @property
    def skills_path(self) -> Path:
        return self.home / self.skills_dir

    @property
    def agents_path(self) -> Path:
        return self.home / self.agents_dir


def default_home(host: str, env: dict[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    home = Path(env.get("HOME") or str(Path.home()))
    if host == "codex":
        return Path(env.get("CODEX_HOME") or home / ".codex").expanduser()
    if host == "opencode":
        return Path(env.get("OPENCODE_CONFIG_DIR") or home / ".config" / "opencode").expanduser()
    if host == "claude":
        return Path(env.get("CLAUDE_CONFIG_DIR") or home / ".claude").expanduser()
    raise ValueError("Unknown host: " + host)


def host_profile(host: str, home: str | Path | None = None,
                 env: dict[str, str] | None = None) -> HostProfile:
    if host not in HOSTS:
        raise ValueError("Unknown host: " + host)
    root = Path(home).expanduser() if home is not None else default_home(host, env)
    if host == "codex":
        return HostProfile(host, root, "AGENTS.md", "skills", "agents", "codex", True, None)
    if host == "opencode":
        return HostProfile(host, root, "AGENTS.md", "skills", "agents", "opencode", False,
                           "open-spec-mesh.opencode.json")
    return HostProfile(host, root, "CLAUDE.md", "skills", "agents", "claude", False,
                       "open-spec-mesh.mcp.json")


def load_role(source: Path, role: str) -> dict:
    if role not in ROLES:
        raise ValueError("Unknown role: " + role)
    data = tomllib.loads((source / "agents" / f"{role}.toml").read_text(encoding="utf-8"))
    required = {"name", "description", "developer_instructions"}
    if not required <= set(data) or data["name"] != role:
        raise ValueError("Invalid canonical role: " + role)
    return data


def _host_skill_note(profile: HostProfile) -> str:
    if profile.name == "codex":
        return f"Skill 根为 {profile.skills_path}/。"
    label = "OpenCode" if profile.name == "opencode" else "Claude Code"
    return f"Skill 使用 {label} 原生 discovery；全局 Skill 根为 {profile.skills_path}/。"


def _adapt_prompt(text: str, profile: HostProfile) -> str:
    """Replace Codex-only launch/path wording without changing role semantics."""
    dispatch = profile.home / "open-spec-mesh" / "dispatch-contract.md"
    text = re.sub(
        r"Skill 根为 \$CODEX_HOME/skills/（缺省 ~/.codex/skills/）。",
        _host_skill_note(profile),
        text,
    )
    text = text.replace("$CODEX_HOME/agents/dispatch-contract.md", str(dispatch))
    text = text.replace("agents/dispatch-contract.md", str(dispatch))
    text = text.replace("- Skill 根：`$CODEX_HOME/skills/`。", "- " + _host_skill_note(profile))
    if profile.name == "opencode":
        text = text.replace(
            '- V2：`agent_type` + `fork_turns="none"`；model / effort 由角色 TOML 固定。',
            "- Agent：使用 OpenCode 原生 primary/subagent 与 subagent tool；model/provider 继承用户宿主配置。"
        )
        text = text.replace(
            '使用 agent_type + fork_turns="none"，不覆盖 model / effort。',
            "使用 OpenCode 原生 subagent tool 调用命名 subagent；不在派发时覆盖用户 model/provider。"
        )
    elif profile.name == "claude":
        text = text.replace(
            '使用 agent_type + fork_turns="none"，不覆盖 model / effort。',
            "使用 Claude Code 原生 Agent tool 调用命名 subagent；不在派发时覆盖用户 model/provider。"
        )
        text = text.replace(
            '- V2：`agent_type` + `fork_turns="none"`；model / effort 由角色 TOML 固定。',
            "- Agent：使用 Claude Code 原生 Agent/subagent；model/provider 继承用户宿主配置。"
        )
    return text


def _yaml_scalar(value: str) -> str:
    # JSON double-quoted strings are valid YAML scalars and avoid ad-hoc escaping.
    return json.dumps(value, ensure_ascii=False)


def _opencode_permissions(role: str) -> list[str]:
    allowed = ROLES if role == "main" else (("explorer", "librarian") if role == "architect" else ())
    lines = [
        "permissions:",
        "  - action: subagent",
        '    resource: "*"',
        "    effect: deny",
    ]
    for name in allowed:
        lines += [
            "  - action: subagent",
            f"    resource: {name}",
            "    effect: allow",
        ]
    if role in ("reviewer", "explorer", "librarian"):
        lines += [
            "  - action: edit",
            '    resource: "*"',
            "    effect: deny",
        ]
    return lines


def render_main(source: Path, host: str, home: str | Path | None = None) -> str:
    profile = host_profile(host, home)
    if host == "codex":
        return (source / "AGENTS.md").read_text(encoding="utf-8")
    prompt = _adapt_prompt((source / "AGENTS.md").read_text(encoding="utf-8"), profile)
    description = "Open Spec Mesh Main：Quick/SDD 路由、调度、验收、集成与最终验证。"
    if host == "opencode":
        front = [
            "---",
            f"description: {_yaml_scalar(description)}",
            "mode: primary",
            *_opencode_permissions("main"),
            "---",
        ]
    else:
        front = [
            "---",
            "name: main",
            f"description: {_yaml_scalar(description)}",
            "model: inherit",
            "tools: Agent(architect, worker, reviewer, explorer, librarian), Read, Write, Edit, Bash, Glob, Grep, Skill, WebFetch, WebSearch",
            "---",
        ]
    return "\n".join(front) + "\n\n" + prompt.rstrip() + "\n"


def render_role(source: Path, host: str, role: str,
                home: str | Path | None = None) -> str:
    profile = host_profile(host, home)
    data = load_role(source, role)
    if host == "codex":
        return (source / "agents" / f"{role}.toml").read_text(encoding="utf-8")
    prompt = _adapt_prompt(data["developer_instructions"], profile)
    description = data["description"]
    if host == "opencode":
        front = [
            "---",
            f"description: {_yaml_scalar(description)}",
            "mode: subagent",
            *_opencode_permissions(role),
            "---",
        ]
    else:
        tools = {
            "architect": "Agent(explorer, librarian), Read, Write, Edit, Bash, Glob, Grep, Skill, WebFetch, WebSearch",
            "worker": "Read, Write, Edit, Bash, Glob, Grep, Skill",
            "reviewer": "Read, Bash, Glob, Grep, Skill",
            "explorer": "Read, Bash, Glob, Grep, Skill",
            "librarian": "Read, Bash, Glob, Grep, Skill, WebFetch, WebSearch",
        }[role]
        front = [
            "---",
            f"name: {role}",
            f"description: {_yaml_scalar(description)}",
            "model: inherit",
            f"tools: {tools}",
            "---",
        ]
    return "\n".join(front) + "\n\n" + prompt.strip() + "\n"


def render_rules(source: Path, host: str, home: str | Path | None = None) -> str:
    profile = host_profile(host, home)
    text = _adapt_prompt((source / "AGENTS.md").read_text(encoding="utf-8"), profile)
    if host == "claude":
        text = (
            "# Open Spec Mesh\n\n"
            "This file is the Claude Code host adapter for the shared Open Spec Mesh rules.\n\n"
            + text
        )
    return text.rstrip() + "\n"


def adapt_skill_markdown(text: str, host: str, home: str | Path | None = None) -> str:
    """Rewrite only host-install path idioms; do not rewrite host-specific explanatory sections."""
    profile = host_profile(host, home)
    if host == "codex":
        return text
    skill_root = str(profile.skills_path)
    text = text.replace(
        'python3 "$CODEX_HOME/skills/sdd-migrate/scripts/migrate_project.py"',
        f'python3 "{skill_root}/sdd-migrate/scripts/migrate_project.py"',
    )
    text = text.replace(
        '安装后使用 `$CODEX_HOME/skills/` 下对应脚本。',
        f'安装后使用 `{skill_root}/` 下对应脚本。',
    )
    return text


def render_dispatch_contract(source: Path, host: str, home: str | Path | None = None) -> str:
    profile = host_profile(host, home)
    return _adapt_prompt(
        (source / "agents" / "dispatch-contract.md").read_text(encoding="utf-8"),
        profile,
    ).rstrip() + "\n"


def render_mcp_overlay(host: str, commands: dict[str, str], *,
                       laya: dict | None = None) -> str:
    """Return package-owned additive config. Values contain env references, never secrets."""
    required = {"codegraph", "context7", "tavily"}
    missing = required - set(commands)
    if missing:
        raise ValueError("Missing research tool commands: " + ", ".join(sorted(missing)))

    if host == "opencode":
        servers = {
            "codegraph": {
                "type": "local",
                "command": [commands["codegraph"], "serve", "--mcp"],
            },
            "context7": {
                "type": "local",
                "command": [commands["context7"]],
                "environment": {"CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"},
            },
            "tavily": {
                "type": "local",
                "command": [commands["tavily"]],
                "environment": {"TAVILY_API_KEY": "{env:TAVILY_API_KEY}"},
            },
        }
        if laya:
            servers["laya"] = {
                "type": "local",
                "command": [laya["command"], *laya.get("args", [])],
                "environment": {
                    name: "{env:" + name + "}" for name in laya.get("env_vars", [])
                },
            }
        return json.dumps(
            {"$schema": "https://opencode.ai/config.json", "mcp": {"servers": servers}},
            ensure_ascii=False, indent=2
        ) + "\n"

    if host == "claude":
        servers = {
            "codegraph": {
                "type": "stdio",
                "command": commands["codegraph"],
                "args": ["serve", "--mcp"],
            },
            "context7": {
                "type": "stdio",
                "command": commands["context7"],
                "args": [],
                "env": {"CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"},
            },
            "tavily": {
                "type": "stdio",
                "command": commands["tavily"],
                "args": [],
                "env": {"TAVILY_API_KEY": "${TAVILY_API_KEY}"},
            },
        }
        if laya:
            servers["laya"] = {
                "type": "stdio",
                "command": laya["command"],
                "args": list(laya.get("args", [])),
                "env": {name: "${" + name + "}" for name in laya.get("env_vars", [])},
            }
        return json.dumps({"mcpServers": servers}, ensure_ascii=False, indent=2) + "\n"

    raise ValueError("MCP overlay is only used for opencode/claude")


def native_artifact_paths(host: str, home: str | Path | None = None) -> dict[str, Path]:
    profile = host_profile(host, home)
    result = {
        "rules": profile.rules_path,
        "skills": profile.skills_path,
        "agents": profile.agents_path,
        "dispatch": profile.home / "open-spec-mesh" / "dispatch-contract.md",
    }
    if profile.mcp_overlay:
        result["mcp_overlay"] = profile.home / profile.mcp_overlay
    return result
