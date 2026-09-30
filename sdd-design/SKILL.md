---
name: sdd-design
description: SDD 模式的整体设计阶段入口；基于已确认需求设计总体方案、模块职责、公共约定和风险，不负责需求收敛或任务拆分与任务级设计。
---
# 整体设计

读取当前 Change 的已确认需求与相关 Current Truth，编写或修订 C02-design.md。说明当前基线、变更与目标、总体方案、模块职责、关键流程、必要公共接口/数据约定、风险及验证方向；信息按实际复杂度展开，不要求固定空章节。

需求缺口影响方案时推荐 `$sdd-req` 收敛受影响需求，不自行批准。需要设计骨架时使用 `open-spec-mesh ensure-design CHANGE_ID --root PROJECT`，或本技能的 `scripts/ensure_design.js`；已有设计不覆盖。不在此阶段拆分任务或编写每项任务的设计，不穷举文件、函数和编码步骤。

完成后交用户确认整体设计，下一阶段引导示例：`$sdd-plan 整体设计已确认，编写执行计划，包含任务拆分和任务设计`。不要自动创建任务或开始实现；用户明确授权多个阶段时按授权范围交接。

写作参考：[整体设计模板](references/design-template.md)、[文档契约](../sdd-init/references/document-contract.md)。
