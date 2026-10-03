# Agent Routing

## 模块定位

区分人工阶段、角色职责、宿主原生格式与本次派发上下文。当前 Agent 控制授权范围并收敛真实结果；没有自动 SDD 状态机替用户推进阶段。

## 局部路由原则

- Quick 由当前 Agent 实现；委派有明确净收益时，本地事实使用 Explorer，外部当前事实使用 Librarian；不按文件数机械委派。
- SDD 由用户逐阶段确认；明确一次授权多个阶段时在该范围连续执行。Architect 可辅助当前已授权阶段，不是必经角色。
- 单任务/串行继续使用当前 Agent、当前工作区，不启动 Worker 或 worktree。
- 仅用户确认并行实现时派发 Worker，每个并行写任务使用独立 worktree；Main 用普通 Git 收敛结果。
- Reviewer 仅用户明确要求独立复审时启用。
- Architect 只可委派 Explorer / Librarian；Worker / Reviewer / Explorer / Librarian 不可继续委派。
- 公共 dispatch-contract.md 传目标、宏观范围、验收与必要证据，不含自动冻结或文件授权协议。

## Host 映射

| Host | 原生格式 | 委派限制 | 模型策略 | Session |
| --- | --- | --- | --- | --- |
| Codex | AGENTS.md + agents/*.toml | V2 configured roles | Role TOML 固定 model/effort | Codex thread UUID |
| OpenCode | AGENTS.md + agents/*.md + overlay agent map | V1 permission.task allowlist | 继承用户当前 model/provider | OpenCode session ID |
| Claude Code | CLAUDE.md + agents/*.md | Main / Architect Agent allowlist；其他角色无 Agent | model: inherit | Claude session ID / name |

Host Adapter 从 canonical agents/*.toml 渲染角色；非 Codex 不复制 Codex 模型名。OpenCode 适配目标是 opencode CLI 的 V1 输入，使用 agent / prompt / permission 与直接命名的 mcp 项，不以 opencode2 的 agents / system / permissions 格式代替。实际本机原生解析证据见已归档协作优化 Change Delivery，不据此承诺未验证宿主版本。

## 路由分层

| 层 | 负责 |
| --- | --- |
| 人工授权 | 用户确认阶段、串并行和实质范围变化 |
| Main 协调 | 按收益选择只读调查；串行实现；必要的并行派发与集成 |
| Role 行为 | canonical Role prompt 的长期方法与边界 |
| Host Adapter | native frontmatter、permission、路径和模型继承 |
| Dispatch 上下文 | 本次目标、宏观 Task、真实依赖/工作区、验收与必要工件引用 |
| 历史观测 | 旧 Graph、receipt、session 只读证据，不是新流程授权 |

## 派发与恢复

Codex 使用 agent_type + fork_turns="none"，不覆盖角色模型/effort。OpenCode 使用命名 subagent，Claude 使用原生 Agent tool。复用匹配目标的原 session，只传增量；历史 session 不因命名规范重新创建。串行返工由当前 Agent 继续，已派发的并行 Task 普通返工优先原 Worker。

并行前明确真实输入、依赖与可用基线；没有可保全基线时不自动 stash/reset/rebase。路径重叠是集成成本因素，不是文件白名单。普通必要文件和局部实现调整由执行者自行处理；目标、验收、安全或重要公共方案变化才请用户确认。

## 权限与结果边界

原生 permission/tool allowlist 减少误用，但不是 OS ACL，也不赋予派发上下文额外权限。文档检查给建议；当前 Agent 核对真实 diff、测试与安全结果，失败如实记录。工具通过、代理完成和旧 accepted 记录不能替代人工确认。

## Agent 命名

新代理的 task_name / 可控会话标题采用 role_desc，例如 explorer_python_inventory、librarian_node_backend、worker_document_tools。实际角色前缀与 agent_type 一致，描述为小写 snake_case；角色 ID 不改名，历史 session 原名保留。

## 连续执行与证据复用

已有 session 先读结果再决定是否继续，不为查询进度唤醒模型，不密集轮询；派发按 [协作契约](../../../agents/dispatch-contract.md) 传最小上下文和验证责任。同一执行者完成调查、实现、修复闭环；公共契约变化只协调受影响任务。Worker 定向验证、Main 集成验证，仅证据失效或不足时补跑重叠检查。

按需使用 inspect-host 只读检查受管文件、包默认值及安全的 model/effort；不解析全部用户覆盖优先级，也不能证明活动会话已重载。

## 默认回退与真实委派

核验需区分Main覆盖、角色TOML与default_subagent_model；角色一致不代表默认回退一致。安装默认保留自定义回退，明确修复时仅迁移已知旧值。真实最小委派可在安装/升级验证时显式执行；平时不调用模型预检，不把native fixture当真实推理。
