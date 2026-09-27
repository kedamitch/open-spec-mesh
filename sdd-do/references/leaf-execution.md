# 叶子角色执行与隔离

## 默认：原生 Multi-Agent V2

Main / Architect 默认使用 Codex V2 原生角色路由：

```text
spawn_agent(
  task_name=...,
  agent_type=worker|reviewer|explorer|librarian,
  fork_turns="none",
  message=明确的目标/范围/版本/必要证据
)
```

角色 TOML 固定 model、reasoning effort 和 developer instructions；不要在 spawn 时再次覆盖。使用配置角色时不要省略 `fork_turns="none"`：V2 默认全历史 fork，与角色/model/effort override 的语义存在冲突。

Worker、Reviewer、Explorer、Librarian 的“不继续委派”和只读职责是工作约束。当前 V2 不把 `agents.max_depth` 作为硬限制，角色层的 `sandbox_mode` / multi-agent 开关也不能单独视为已验证的权限边界。

## 按需：独立进程 fallback

只有任务明确要求更强的会话级隔离，或需要验证“无原生 agent 工具”的执行环境时，才使用 `run_leaf.py`：

```sh
python "$CODEX_HOME/skills/sdd-do/scripts/run_leaf.py" worker \
  --root "$WORKTREE" --prompt-file "$TASK_PROMPT"
```

它启动独立 Codex 进程，显式关闭 V1/V2 multi-agent 特性，并传入角色 model / effort / instructions / sandbox。需要返工时用原 thread id 恢复：

```sh
python "$CODEX_HOME/skills/sdd-do/scripts/run_leaf.py" worker \
  --root "$WORKTREE" --resume "$THREAD_ID" --prompt-file "$FEEDBACK"
```

这是兼容与隔离 fallback，不是默认调度层；不得把独立 CLI 进程数量与 V2 会话并发预算混为一谈。

## 验证边界

CI 分别检查：
- 原生 V2 能按 `agent_type + fork_turns="none"` 载入角色模型和 effort；
- Architect 能原生委派 Explorer；
- 独立进程 fallback 的 CLI 参数会关闭 multi-agent 特性。

这些检查不证明模型质量、计费或操作系统级文件隔离。