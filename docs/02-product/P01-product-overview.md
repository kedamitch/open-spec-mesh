# 产品总览

## 产品定位与边界

面向 Codex 开发者的本地 SDD 配置与工具包：用明确契约、有限委派、真实 Git 证据和可回放交付约束研发流程。

边界：

- 不提供常驻调度服务。
- 不自动上线业务系统。
- 不把 Agent 角色当独立业务应用。
- Quick 不创建 SDD Change / Task 工件。

## 用户与核心场景

| 用户 / 角色 | 核心场景 | 目标 |
| --- | --- | --- |
| 开发者 / Main | 小改动直接完成 | 快速实现、测试、自审并同步事实 |
| 开发者 / Architect | 需要多 Task 的 SDD 规划 | 一次性形成 Change、Design、Task Graph 和 Task Design |
| Worker | 执行冻结 Task | 按局部设计实现、测试、自审和 Delivery |
| Reviewer | 用户明确要求的独立复审 | 只记录真实 Findings |

## 产品架构

[产品架构图](P03-diagrams/P03-01-product-architecture.md) 展示 Quick / SDD、规划、实现、验收和底层证据能力。

## 模块总览

| 模块 | 职责 | 核心能力 | 主要场景 | 文档 |
| --- | --- | --- | --- | --- |
| SDD Runtime | 契约、Task、baseline、attempt、交付、验收与恢复 | 状态门、冻结、派发、返工、归档 | SDD 任务 | [Runtime](P02-modules/P02-01-sdd-runtime.md) |
| Agent Routing | 角色职责和有限委派 | Main / Architect / Worker / Reviewer / Explorer / Librarian | 多 Agent 协作 | [Routing](P02-modules/P02-02-agent-routing.md) |
| Installation | 受管安装与升级 | 工具检测、配置保留、迁移、失败恢复 | 初始化 / 升级 | [Installation](P02-modules/P02-03-installation.md) |
| Behavior Observation | 零额外模型调用的运行证据 | rollout 归一化、确定性诊断、汇总 | 复盘 / 诊断 | [Observation](P02-modules/P02-04-behavior-observation.md) |

## 核心业务流程

[主用户流程](P03-diagrams/P03-02-main-user-flow.md)。

## 跨模块业务规则

- 未完成变化留在 Change；已验收事实同步回 Current Truth。
- Delivery ≠ Acceptance；Acceptance ≠ Integration；Archive ≠ Release。
- SDD 的 Task Graph 由 Architect 直接产出，Main 不二次拆分。
- Task Graph JSON 只保存拓扑与运行状态，不替代人类 Design。
- 冻结 Contract 必须变化时，先取得用户明确确认再 replan。

## 外部系统

| 系统 | 用途 | 交互边界 |
| --- | --- | --- |
| Codex 客户端 | 加载 Skill / Role、维护会话 | 本包不控制其模型身份与 UI |
| 模型 Provider | 提供推理结果 | 由用户配置；本包只配置调用侧 |
| Git | revision、diff、worktree、祖先关系 | SDD 身份与交付证据基础 |
| CodeGraph / Context7 / Tavily / Web | 按需调查 | 只读证据，不替代设计决策 |
