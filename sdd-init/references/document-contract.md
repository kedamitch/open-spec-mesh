# 文档契约

**目标**：文档首先服务人类 Review，其次才服务脚本。Current Truth 说明“现在是什么”，Change/Design/Task 说明“为什么改、整体怎么改、局部怎么实现”，Delivery 只记录“实际改了什么”。

## 目录契约

```text
docs/
├── index.md
├── 01-governance/
│   ├── index.md
│   └── G01-sdd-workflow.md
├── 02-product/
│   ├── index.md
│   ├── P01-product-overview.md
│   ├── P02-modules/
│   │   ├── index.md
│   │   └── P02-xx-<module>.md
│   └── P03-diagrams/
│       ├── index.md
│       └── P03-xx-<diagram>.md
├── 03-architecture/
│   ├── index.md
│   ├── T01-architecture-overview.md
│   ├── T02-api.md
│   ├── T03-database.md
│   ├── T04-domain-model.md
│   └── T05-diagrams/
│       ├── index.md
│       └── T05-xx-<diagram>.md
├── 04-operations/
│   ├── index.md
│   ├── O01-operations-overview.md
│   ├── O02-applications/
│   │   ├── index.md
│   │   └── O02-xx-<application>.md
│   └── O03-diagrams/
│       ├── index.md
│       └── O03-xx-<diagram>.md
├── 05-changes/
│   ├── index.md
│   ├── C01-进行中/
│   │   └── CHG-YYYYMMDD-<name>/
│   │       ├── index.md
│   │       ├── C01-change.md
│   │       ├── C02-design.md
│   │       └── C03-tasks/
│   │           ├── index.md
│   │           ├── C03-task-graph.json
│   │           └── C03-xx-<task>/
│   │               ├── index.md
│   │               ├── C03-xx-01-task.md
│   │               └── C03-xx-02-delivery.md
│   └── C02-已完成/
│       └── <same change layout>
├── 06-decisions/
│   ├── index.md
│   └── ADR-xxx-<decision>.md
├── 07-research/
│   ├── index.md
│   └── Rxx-<topic>.md
├── 08-quality/
│   ├── index.md
│   ├── Q01-validation.md
│   └── Q02-reviews/
│       ├── index.md
│       └── Q02-xx-<review>.md
└── 09-delivery/
    ├── index.md
    └── D01-发布记录/
        ├── index.md
        └── D01-xx-<version>/
            ├── index.md
            ├── D01-xx-01-release-notes.md
            └── D01-xx-02-release-checklist.md
```

约束：

- 一级目录固定 01–09。
- 正式文档使用英文文件名 + 中文 Markdown 正文。
- `C03-task-graph.json` 是唯一机器状态文件，不承担人类设计职责。
- Task 保留独立编号目录，一个 Task 同时维护 Task Design 与 Delivery。
- 旧 Change 布局不是合法输入，不保留兼容读取。

## 信息职责

| 工件 | 回答的问题 | 单一事实源 |
| --- | --- | --- |
| Current Truth | 系统现在完整是什么样 | 02-product / 03-architecture / 04-operations |
| Change | 为什么改、改什么、怎么验收 | C01-change.md |
| Design | 相对 Current 整体怎么改 | C02-design.md |
| Task | 这个 Task 如何实现 | C03-xx-01-task.md |
| Task Graph | Task 拓扑和运行状态 | C03-task-graph.json |
| Delivery | 实际改了什么、验证结果和剩余问题 | C03-xx-02-delivery.md |
| ADR | 跨 Change 的长期选择 | 06-decisions |
| Research | 可复用调研结论与证据 | 07-research |
| Release | 版本级变化与发布检查 | 09-delivery |

**Current 写最终事实，Change 写 Delta。** 同一事实不维护多个副本。

## index.md

所有目录都有 `index.md`，只负责 Purpose、Documents、Navigation。自动 INDEX 区可以维护链接，但不得变成第二份正文。

## Current Truth

### Product Overview

固定内容：产品定位与边界、用户与场景、产品架构图、模块总览、核心业务流程、跨模块业务规则、外部系统。

### Product Module

每个真实模块至少包含：模块定位、核心能力、功能清单、用户流程、业务规则、页面与交互（如有）、依赖模块、相关领域模型、相关 API。

### Architecture Overview

至少包含：系统范围、应用架构图、应用职责、核心技术栈、应用交互、外部依赖、公共机制，以及 API / Database / Domain / Operations 链接。

### API

先维护接口清单，再展开关键 Contract：Method / Path / Purpose / Auth、Request / Response、Error Codes、Idempotency、Compatibility。

### Database

维护当前真实 Schema：存储概览、Table List、ER、Columns、Indexes、Constraints、Relations、一致性规则。历史迁移过程只留在 Change。

### Domain Model

领域模型与数据库分开维护：Domain Overview、Aggregates / Entities / Value Objects、对象关系、状态机、Domain Rules / Invariants、存在时的 Domain Events。

### Operations

至少包含 Environments、Deployment Architecture、Configuration、Network、Observability、Backup & Recovery、Security、Common Operations。每个可部署应用独立文档，包含 Runtime、依赖、端口、环境变量、Dockerfile、Build、一行 Deploy、Health Check、Logs、Start/Stop/Restart、Rollback；配置通过外置 `.env`。

## Change

固定顺序：背景与问题 → 目标与范围 → Requirements → 行为与 AC → 约束与待确认 → 影响范围 → 真实验证 / 最终结论。Change 不写详细实现方案。

## Design

Design 是 **Current Truth 的完整增量设计**：

1. Current 基线与受影响文档。
2. 总体方案。
3. 总业务流程或主时序，必须有真实 Mermaid。
4. 产品模块 / 功能 / 规则变化。
5. API / 协议变化与兼容。
6. 领域模型 / 状态机 / 不变量变化。
7. 表 / 字段 / 索引 / 约束 / 数据迁移变化。
8. 应用职责 / 模块 / 依赖变化。
9. 跨 Task 公共设计：事务、一致性、幂等、并发、失败恢复、兼容。
10. 人类可读 Task Graph：Task、依赖、输出、AC、设计落点。
11. 风险、停止条件、未决问题。

必须表达 **Current → Delta → Target**。固定设计维度和标题全部保留；没有变化时直接在该标题下写“无变化。”，不再生成空子标题、空表或“无变化”占位行。有变化时只展开承载新增信息所需的表格、列表或短段落；表格已经表达的事实不再用正文重复一遍。

## Task

Task 是可执行的局部详细设计；Worker 拿到 Task 后不应再猜主要实现结构。固定内容：Goal、Included/Excluded、Inputs/Dependencies、代码结构、Task 流程、Components、本地 Domain/Database/API 变化、Implementation Constraints、Error/Edge Cases、Tests、AC、Expected Output。Task 以业务范围和实现约束表达授权边界，不生成文件路径 allow/deny 清单。固定维度全部保留；没有变化的子项直接写“无变化。”，不生成空表。公共设计只在 Design 展开，Task 引用 Dxxx 后只写当前 Task 如何落实，不重复公共原因与结论。每个 Task 至少一个真实 Mermaid；类图按需。

## Delivery

Delivery 固定五节：文件改动、验证结果、自审结论、剩余问题、快照影响。关键内容使用固定字段：交付结果；验证结论与逐 AC 结果；已修复问题 / 契约偏差；未验证项 / 剩余风险；快照范围 / 说明。文件行由真实 Git diff 约束，AC 行由 Task Contract 约束；`deliver --draft` 自动生成两类骨架，Worker 只填写实际行为与证据。

Delivery 可真实记录“部分通过 / 未通过”，但总体写“通过”时不得存在失败/未执行 AC、契约偏差或未验证项。Main Acceptance 仍是独立判断：结构化 Delivery 只能证明明显不满足时必须拒绝，不能自动证明应该验收。全部 Task 集成后的项目全量测试 / build / static validation 属于 Main 的最终集成验收，不属于每个 Delivery。

## ADR

仅记录跨 Change 的长期决策：Status、Context、Decision、Alternatives、Consequences、Impact、Related Documents、Supersedes / Superseded By。

## Research

Question / Scope → Conclusion → Findings → Options → Evidence & Limitations → Recommendation（有授权且证据足够时）→ Impact → References。结论优先，不保存搜索流水账。

## Quality Review

只记录真实发现：Scope、Conclusion、Critical/Major/Minor Findings、Required Fixes、Verification。关注正确性、数据、安全、性能、兼容性、可靠性、可维护性、测试；没发现的类别不机械展开。

## Release

Release Notes：Version / Date、Highlights、Added/Changed/Fixed/Removed、Breaking Changes、Migration、Related Changes、Known Issues、Rollback Notes。

Release Checklist：Build、Tests、Database、Configuration、Documentation、Deployment、Rollback。

## 表达原则

- 文档首先服务人类 Review；机器字段只是稳定锚点和运行状态。
- 机器 ID 只作为稳定引用锚点：AC、Dxxx、Task ID 首次出现必须同时带语义标题。
- 禁止把 `depends_on / AC / Design / contract_digest / attempt` 等协议字段当成正文主结构。
- 图 > 表 > 列表 > 短段落。
- 标题表达业务/设计问题，不表达协议字段。
- 表格用于清单和差异，长理由不用表格堆砌；表格已有事实不在正文重复。
- 固定设计标题必须保留；无变化时标题下直接写“无变化。”，不生成空表。
- 复杂关系、流程、状态优先 Mermaid。
- 公共规则只在 Design 写一次；Task 引用并写本地实现，不重复公共设计。
- AC / Dxxx / Task ID 第一次出现时“编号 + 语义”。
- 未核实内容写“待核实 / 待补充”，不得补猜。
- 必需内容未完成时阻止派发。
