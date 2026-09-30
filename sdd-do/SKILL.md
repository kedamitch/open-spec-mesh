---
name: sdd-do
description: SDD 模式已授权实现阶段的入口；当前 Agent 串行或 Worker 并行实现、验证、自审和真实交付，也可用于 Quick 已授权实现。
---
# 当前 Agent 串行或 Worker 并行的自主实现、验证、自审和真实交付。

单任务或串行由当前 Agent 在当前工作区连续执行；只有用户确认并行时才使用 Worker 与独立 worktree。读取需求、整体设计、执行计划及当前 Task 的任务级设计，明确目标/依赖/验收后实现。

实现 → 定向测试 → 自审 → 修复 → 复验。必要文件、内部结构和测试可自行调整；仅实质目标、验收、安全或公共方案变化返回 Main 请用户决定。完成时写真实 Delivery，不调用冻结、prepare、record-delivery 或验收状态链。不要反复跑全量，项目集成验证由当前 Agent 完成。

## 阶段引导

说明当前实现授权和串并行选择。SDD 模式缺少已确认的必要需求、整体设计或执行计划时，分别推荐 `$sdd-req`、`$sdd-design` 或 `$sdd-plan` 补充受影响阶段，不自行批准；Quick 不强制建 Change/Task。实现与验证完成后报告真实结果，并推荐 `$sdd-close 汇总实现结果和验证，先供我确认`；调用下一技能不代替用户确认，也不自动归档或发布。

写作参考：sdd-init/references/document-contract.md。
