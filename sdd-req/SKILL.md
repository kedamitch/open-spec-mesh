---
name: sdd-req
description: SDD 模式的需求阶段入口；创建或完善 Change 的目标、范围、约束和可观察验收，不编写整体设计或执行计划。
---
# 需求

按用户当前授权创建或完善 C01-change.md。说明问题与目标、本次包含和不做事项、限制、待确认项与可观察验收；缺失的关键事实如实标为未知，必要时向用户收敛，不把实现方案提前当作需求。

已有 Change 时沿用原文档，不重复创建。缺少合适文档骨架时才推荐 `$sdd-init`。需要创建需求文档时使用 `open-spec-mesh new-change TITLE --root PROJECT`，或本技能的 `scripts/new_change.js`；该命令仅生成需求与导航，不预建整体设计、任务、执行 Graph 或 Delivery。

完成后交用户确认需求阶段，记录真实确认而非推断批准。下一阶段引导示例：`$sdd-design 需求已确认，编写整体设计`。用户只授权需求时，不自动补齐后续材料；明确一次授权多个阶段时仅在授权范围内交接对应技能。

写作参考：[需求模板](references/change-template.md)、[文档契约](../sdd-init/references/document-contract.md)。
