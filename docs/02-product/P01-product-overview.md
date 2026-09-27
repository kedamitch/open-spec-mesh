# 产品总览

## 产品定位与边界

面向 Codex、OpenCode 与 Claude Code 开发者的本地 SDD 工具包：用明确契约、有限委派、真实 Git 证据和可回放交付约束研发流程。三种宿主共享一套 SDD Core；宿主差异由确定性 Adapter 处理。

边界：

- 不提供常驻调度服务。
- 不自动上线业务系统。
- 不把 Agent 角色当独立业务应用。
- Quick 不创建 SDD Change / Task 工件。
- 不接管用户模型/provider；非 Codex host 默认继承宿主当前模型。
- SDD prepare/worktree 是写任务唯一 Git 执行身份，不叠加宿主自动 worktree。

## 用户与核心场景

| 用户 / 角色 | 核心场景 | 目标 |
| --- | --- | --- |
| 开发者 / Main | Quick 或 SDD 调度 | 在任一支持宿主保持相同流程语义 |
| Architect | SDD 规划 | 一次性形成 Change、Design、Task Graph 和 Task Design |
| Worker | 执行冻结 Task | 在 prepare workspace 中实现、测试、自审和 Delivery |
| Reviewer | 用户明确要求的独立复审 | 只记录真实 Findings |

## 产品架构

[产品架构图](P03-diagrams/P03-01-product-architecture.md) 展示 Quick / SDD、规划、实现、验收和底层证据能力。

## 模块总览

| 模块 | 职责 | 核心能力 | 主要场景 | 文档 |
| --- | --- | --- | --- | --- |
| SDD Runtime | 契约、Task、baseline、attempt、交付、验收与恢复 | 状态门、冻结、派发、返工、归档 | SDD 任务 | [Runtime](P02-modules/P02-01-sdd-runtime.md) |
| Agent Routing | canonical Role → host-native Agent | Main / Architect / Worker / Reviewer / Explorer / Librarian | 多 Agent 协作 | [Routing](P02-modules/P02-02-agent-routing.md) |
| Installation | 三宿主受管安装与升级 | Rules / Skills / Agents / MCP overlay、配置保留、失败恢复 | 初始化 / 升级 | [Installation](P02-modules/P02-03-installation.md) |
| Behavior Observation | 零额外模型调用的运行证据 | Codex full trace；OpenCode/Claude artifact-only partial | 复盘 / 诊断 | [Observation](P02-modules/P02-04-behavior-observation.md) |

## 核心业务流程

[主用户流程](P03-diagrams/P03-02-main-user-flow.md)。

## 跨模块业务规则

- 未完成变化留在 Change；已验收事实同步回 Current Truth。
- Delivery ≠ Acceptance；Acceptance ≠ Integration；Archive ≠ Release。
- SDD 的 Task Graph 由 Architect 直接产出，Main 不二次拆分。
- Task Graph JSON 只保存拓扑与运行状态，不替代人类 Design。
- 冻结 Contract 必须变化时，先取得用户明确确认再 replan。
- HostProfile / HostCapability 是运行时映射，不进入 Task Graph 状态。

## 外部系统

| 系统 | 用途 | 交互边界 |
| --- | --- | --- |
| Codex / OpenCode / Claude Code | Skill / Role / 会话宿主 | 用户模型/provider/UI 归宿主管理 |
| 模型 Provider | 推理 | 由用户配置 |
| Git | revision、diff、worktree、祖先关系 | SDD 身份与交付证据基础 |
| CodeGraph / Context7 / Tavily / Web | 按需调查 | 只读证据，不替代设计决策 |
