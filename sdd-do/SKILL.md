---
name: sdd-do
description: SDD 模式已授权实现阶段的入口；主 Agent 派发 Worker 或已获授权的执行者实现、验证、自审和真实交付。
---
# SDD 模式实现阶段：主 Agent 派发与 Worker 边界自治

## 核心职责隔离：协调者派发 vs 执行者实现

### 1. 主 Agent（Main / Coordinator）执行守则（L2 规范驱动必须遵守）
- **严禁亲自编码**：在 L2 规范驱动开发中，主 Agent 的身份是架构负责人与流程协调者，**绝对禁止**直接调用 `edit` 或 `write` 工具编写业务代码或单测。
- **任务分流与派发**：
  - **并行任务**：具备独立模块边界且已规划并行工单的任务，主 Agent 进入本阶段的第一步动作**必须且只能是：读取工单 → 组织 Task Brief → 调用 `subagent` 工具并行派发 Worker 执行**。严禁私自就地闭环。
  - **纯串行任务**：若工单存在严格时序依赖，主 Agent 必须在计划阶段完成时通过 `ask_user_question` 获得用户明确选择（由 Worker 串行执行 vs 由主 Agent 就地串行实现）。只有在用户明确选择就地实现时，主 Agent 方可亲自编码。
- **独立严格验收**：等待 Worker 子代理完成并上报交付后，主 Agent 切换至独立验收者身份，运行测试命令、审查 Git Diff、验证各项可验收准则。

### 2. Worker 执行者 / Quick 敏捷执行守则
- 收到 Task Brief 或在 Quick 模式下获得授权后：
  - 自主实现 → 定向测试 → 自审 → 修复 → 复验。
  - 模块边界内完全自治，必要文件、内部结构和测试可自行调整；免写微观详设文档。
  - Quick 不建正式 Change/Task，完成后直接报告改动、验证和剩余问题，不为交付推荐 sdd-close；SDD 完成时写真实增量 Task Delivery 并上报。

## 阶段引导与交接

主 Agent 派发 Worker 完成各工单并独立复核测试通过后，向用户汇报当前实现进展。已有 SDD Change 实现与验证全部完成后，推荐 `$sdd-close 汇总实现结果和验证，先供我确认`；调用下一技能不代替用户确认，也不自动归档或发布。

写作参考：sdd-init/references/document-contract.md。
