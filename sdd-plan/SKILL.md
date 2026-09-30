---
name: sdd-plan
description: SDD 模式的执行计划阶段入口；基于已确认需求和整体设计完成任务拆分、任务级宏观设计、依赖及串并行安排，不直接实施或派发 Worker。
---
# 执行计划：任务拆分与任务设计

读取当前 Change 的已确认 C01 需求和 C02 整体设计。输出人可读的 C03-tasks/C03-task-plan.md 与各独立编号 Task 的任务级设计；不是只列任务名称，也不重复整体设计全文。

## 任务拆分

按可交付业务结果划分宏观任务，说明覆盖范围、依赖关系、必要真实输入、串行/并行建议及理由、集成顺序与整体验证方向。单任务也可以形成简洁计划；文件数、关键词数或测试数不决定拆分粒度。说明尚缺的前置输入，不伪造依赖已完成。

## 任务设计

每项任务说明目标与范围、不做事项、输入与依赖、交付输出、总体实现方向、与共享整体设计的关系、可观察验收及定向验证策略。保持任务级宏观方案，文件路径仅帮助定位，不冻结文件/函数/编码步骤，不生成 Path Contract、机器执行 Graph、digest、attempt 或审批 token。执行者仍可自主处理必要局部调整。

使用 `open-spec-mesh new-task CHANGE_ID TITLE --root PROJECT`（依赖可用 `--depends-on C03-xx`），或本技能的 `scripts/new_task.js` 创建 Task 与导航，再补齐真实执行计划和任务设计。首次建 Task 会生成执行计划骨架；不会创建空 Delivery，也不授予实施权限。

## 阶段交接

前置需求或整体设计存在实质缺口时，分别推荐 `$sdd-req` 或 `$sdd-design`；不自行补批准。完成后交用户确认执行计划，提示需确认的任务设计、依赖和执行方式。下一步示例：`$sdd-do 执行计划已确认，按计划串行实现并验证`。并行计划不等于已授权派发 Worker；只有用户明确确认并行实现时才使用 Worker 和独立 worktree。本技能不实施、不创建工作区、不启动 Worker、不归档或发布。

写作参考：[执行计划模板](references/execution-plan-template.md)、[任务设计模板](references/task-design-template.md)、[文档契约](../sdd-init/references/document-contract.md)。
