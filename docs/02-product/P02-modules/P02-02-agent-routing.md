# Agent Routing

## 模块定位

把 SDD 生命周期、角色语义和宿主执行格式分开。Main / Architect 的语义路由只有一套；Codex、OpenCode、Claude Code 只负责用各自原生 Agent/permission/session 机制承载它。

## 局部路由原则

- Main：可委派 Architect / Worker / Reviewer / Explorer / Librarian。
- Architect：只可委派 Explorer / Librarian。
- Worker / Reviewer / Explorer / Librarian：不可继续委派。
- Reviewer 只有用户明确要求时启用。
- Quick 只使用 Explorer / Librarian；需要 Worker 或独立 Planning Owner 时进入 SDD。
- 公共 `dispatch-contract.md` 只定义 Dispatch Packet，不复制宿主拓扑。

## Host 映射

| Host | Main / Agent 格式 | 委派限制 | 模型策略 | Session |
| --- | --- | --- | --- | --- |
| Codex | `AGENTS.md` + `agents/*.toml` | V2 configured roles | Role TOML 固定 model/effort | Codex thread UUID |
| OpenCode V2 | `AGENTS.md` + `agents/*.md` | ordered `permissions` / `subagent` allowlist | 继承用户当前 model/provider | OpenCode session ID |
| Claude Code | `CLAUDE.md` + `agents/*.md` | Main `Agent(architect,...)`；Architect `Agent(explorer,librarian)`；leaf 无 Agent | `model: inherit` | Claude session ID / name |

Host Adapter 只渲染格式、路径和权限表达；canonical Role prompt 仍来自 `agents/*.toml`。非 Codex host 不复制 `gpt-6-*` 模型名。

## 路由分层

| 层 | 负责 |
| --- | --- |
| SDD State | Runtime：planning、Task state、dependency、Contract drift |
| Deterministic Routing | Runtime + Main：ready/resume/rework/replan gates |
| Semantic Routing | Main / Architect：Quick/SDD、本地/外部未知、实现/设计缺口 |
| Role Behavior | canonical Role prompt |
| Host Adapter | native agent/frontmatter/permission/session 映射 |
| Dispatch Context | goal、scope、baseline、attempt、workspace、AC 与工件引用 |

`sdd.py status` 只返回机械状态和 `allowed_actions`；`prepare` 生成冻结 Worker Dispatch Packet。首次 spawn 后用 `bind-session` 保存宿主 session ID，返工恢复原 Worker。

## 派发与恢复

Codex 使用 V2 `agent_type + fork_turns="none"`。OpenCode 使用命名 subagent 与 ordered `permissions`；Claude Code 使用 Agent tool allowlist。正式 Worker 始终从 `prepare` 返回的 workspace 启动；不启用宿主自己的自动 worktree。

同 Task 复用 Worker，同 Change 复用 Architect。普通实现缺陷在原 Worker 内修复。依赖满足的 Task 可在独立 SDD worktree 并行，Main 负责 ancestry-preserving integration。

## 权限边界

宿主 permission/tool allowlist 用于减少误用，但不等于 OS ACL。Path Contract、Git diff、Delivery、Acceptance 和最终 validation 仍由 SDD Runtime 独立校验。提示词、Agent 名称或 session ID 不能扩权。
