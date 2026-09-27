---
name: sdd-do
description: 在 SDD 冻结 Task Contract 内连续完成实现、测试、自审、修复和逐文件交付。
---
# 实施与交付

**输入**：冻结 Task Contract、授权范围、工作区、baseline / attempt。只处理当前 Task，不接管规划、调度或验收。

1. 先按人类阅读顺序读 Change、共享 Design 和自己的 Task Contract：目标/范围 → Path Contract → 设计方案 → 前置任务/验收 → 本地详细设计/实现自由度；再核对对应 AC、依赖和公共边界后直接实施。默认不读取其他 Task Contract；兄弟 Task 路径重叠不是越界。缺失或互相矛盾时返回 needs_context，不自行补设计。
2. 实现 → 当前 Task 定向测试 → 按 [审查清单](references/review-checklist.md) 自审 → 修复 → 复验，保持同一上下文。只在当前 Task 需要时运行 build/static check，不反复执行项目全量测试。
3. 提交授权改动，用 `sdd.py deliver --draft` 生成 Git 文件表；补 [交付模板](references/delivery-template.md) 的实际影响和验证，再用 `sdd.py deliver` 写入报告。脚本会用实际 Git diff 校验 Path Contract；可直接使用已有完整证据，不重复生成草稿。

脚本生成身份和文件清单，并按 Task Path Contract 校验真实 diff 是否越界；它不代写验证结论。兄弟 Task 路径允许重叠，Path Contract 不承担互斥调度。部署任务按 [运维规范](../sdd-init/references/operations-template.md) 交付实际文件。

**完成**：返回 revision、报告路径和剩余问题。当前执行者不可委派、不改快照、不推进权威任务图。普通缺陷直接修；出现设计缺口返回 needs_context；冻结契约必须变化返回 `contract_change_required` 并停止，由调用方决定后续。

本 Skill 不描述其他角色或全局 Routing。
