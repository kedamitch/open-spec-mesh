# 叶子角色执行与隔离

Open Spec Mesh 的 Worker / Reviewer / Explorer / Librarian 可以由 Codex、OpenCode 或 Claude Code 原生角色机制运行。**SDD prepare 返回的 workspace / baseline / attempt 是执行身份**；宿主只承载 Agent context，不再创建第二层 worktree。

## Codex

默认仍优先原生 Multi-Agent V2：

```text
spawn_agent(
  task_name=...,
  agent_type=worker|reviewer|explorer|librarian,
  fork_turns="none",
  message=Dispatch Packet
)
```

角色 TOML 固定 model / effort / instructions。需要独立进程隔离时使用：

```sh
python "$CODEX_HOME/skills/sdd-do/scripts/run_leaf.py" worker \
  --host codex --root "$WORKTREE" --prompt-file "$TASK_PROMPT"
```

恢复使用精确 Codex thread UUID：

```sh
python "$CODEX_HOME/skills/sdd-do/scripts/run_leaf.py" worker \
  --host codex --root "$WORKTREE" --resume "$THREAD_ID" --prompt-file "$FEEDBACK"
```

## OpenCode

OpenCode 原生读取全局 `AGENTS.md`、`skills/` 与 `agents/*.md`。Open Spec Mesh 的 primary/subagent 权限由生成的 Agent frontmatter 固定；非 Codex host 不写入 Codex 模型名，继承用户当前 provider/model。

独立 leaf：

```sh
python ~/.config/opencode/skills/sdd-do/scripts/run_leaf.py worker \
  --host opencode --root "$WORKTREE" --prompt-file "$TASK_PROMPT"
```

恢复必须传精确 session id：

```sh
python ~/.config/opencode/skills/sdd-do/scripts/run_leaf.py worker \
  --host opencode --root "$WORKTREE" --resume "$SESSION_ID" --prompt-file "$FEEDBACK"
```

launcher 使用 `opencode run --agent <role> --dir <workspace>`；恢复时增加 `--session <id>`。它设置 package-owned config overlay，但不改用户 provider/model。

## Claude Code

Claude Code 原生读取 `CLAUDE.md`、`skills/` 与 `agents/*.md`。Main / Architect 的可委派类型由 `Agent(...)` allowlist 表达；叶子角色不获得 Agent tool。

```sh
python ~/.claude/skills/sdd-do/scripts/run_leaf.py worker \
  --host claude --root "$WORKTREE" --prompt-file "$TASK_PROMPT"
```

恢复：

```sh
python ~/.claude/skills/sdd-do/scripts/run_leaf.py worker \
  --host claude --root "$WORKTREE" --resume "$SESSION_ID" --prompt-file "$FEEDBACK"
```

launcher 使用 `claude -p --agent <role>`，恢复时增加 `--resume <id>`，并通过 `--mcp-config` 附加 Open Spec Mesh 自己的 MCP 配置。Claude 配置根使用 `CLAUDE_CONFIG_DIR`（默认 `~/.claude`）。

## 自动 host

`--host auto`：

1. `OPEN_SPEC_MESH_HOST` 显式设置时使用该值；
2. 为兼容历史，检测到 Codex 时优先 Codex；
3. 仅检测到一个 OpenCode / Claude CLI 时使用它；
4. 两者同时存在且无显式 host 时拒绝猜测。

## 验证边界

- launcher 不创建 worktree，不重置/切换 baseline。
- session id 必须显式；不使用 `--last` 或模糊恢复。
- OpenCode / Claude 默认继承宿主模型，不把 `gpt-6-*` 映射进去。
- CLI / frontmatter smoke 只证明配置形状与命令兼容，不证明模型质量、计费或 OS ACL。
