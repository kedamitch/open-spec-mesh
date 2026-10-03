# 技术写作参考

以下维度是需要时的写作参考，不是必须全部齐备的机器门禁。Task 只做宏观设计，不要求文件/函数级清单。Design 区分必须遵守的约束、可调整的方案和待验证假设；先验证影响后续工作的关键未知，不把假设写成事实。公共背景和验收引用 C01，Task 只补本任务差异。

技术 Current Truth 必须能回答：**系统由哪些应用/模块组成、接口是什么、数据怎么存、核心领域对象如何变化、主流程如何执行、怎么部署。**

## 文件结构

| 文件 | 必须维护的当前事实 |
| --- | --- |
| `T01-architecture-overview.md` | 系统范围、应用架构、应用职责、技术栈、交互、外部依赖、公共机制 |
| `T02-api.md` | 公共协议 + 完整接口清单 + 关键 Contract |
| `T03-database.md` | 存储概览 + 当前完整 Schema + 索引/约束 + 关系与一致性 |
| `T04-domain-model.md` | 领域对象关系 + Aggregate/Entity/Value Object + 状态机 + 不变量 |
| `T05-diagrams/T05-01-system-context.md` | 系统边界与外部参与者 |
| `T05-diagrams/T05-02-application-architecture.md` | 应用架构图 |
| `T05-diagrams/T05-03-main-sequence.md` | 至少一条真实主流程时序 |
| `T05-diagrams/T05-04-domain-state.md` | 核心对象状态机 |

## Architecture Overview

必须说明：

- 系统范围。
- 真实应用 / 进程 / 模块及职责。
- 上下游与外部依赖。
- 同步 / 异步交互。
- 核心技术栈。
- 鉴权、事务、缓存、消息、错误处理、配置等真实存在的公共机制。
- API / Database / Domain / Operations 的入口。

应用架构图必须能映射到这些应用/模块，不能只画抽象三层框。

## API

`T02-api.md` 先维护完整接口清单：

| Method / Type | Path / Name | Purpose | Auth / Permission |
| --- | --- | --- | --- |

接口可为 HTTP、RPC、消息、事件、CLI 或稳定内部协议。关键接口再展开：

- Purpose。
- Request / Response。
- Error Codes。
- Idempotency。
- Compatibility。

## Database

`T03-database.md` 保存**当前完整 Schema**，不是变更日志或 ORM 摘要：

- Storage Overview。
- Table List。
- ER Model。
- 每张表的 Columns / Indexes / Constraints / Relations。
- 事务、一致性、幂等 / 唯一性和历史数据兼容。

历史迁移过程留在 Change / Design。

## Domain Model

`T04-domain-model.md` 必须突出业务语义：

- Domain Overview。
- Aggregates。
- Entities。
- Value Objects。
- Relationships。
- State Machines。
- Domain Rules / Invariants。
- Domain Events（存在时）。

真实状态关系复杂时可用 `stateDiagram-v2`；人工阶段不伪装成机器状态机。

## 主流程时序

复杂主流程可用 `sequenceDiagram`：

- 触发者。
- 参与应用 / 模块。
- 调用顺序。
- 持久化 / 事务点。
- 必要失败 / 恢复分支。

## Change / Design 与 Current

当前设计作者先读受影响 Current Truth，再在 Design 中按 **Current → Delta → Target** 明确：

- 产品模块 / 功能变化。
- 应用 / 组件职责变化。
- API / 协议变化。
- Domain / 状态机变化。
- Schema / 索引 / 约束变化。
- 主流程 / 时序变化。
- Operations 变化。

按实际变化展开，不要求不适用的标题或空章节。Design 表达“这次怎么改”；Current Truth 只表达“集成后现在是什么”。
