---
integrated_revision: pending
product: pending
technology: pending
operations: pending
---
# 变更说明

> **目标**：减少 SDD Planning 重复文字，并把 Delivery 从自由文本收紧为可机械校验的固定字段。

## 背景与问题

Planning 的问题不是维度太多，而是无变化维度仍生成空表、表格后重复解释、Design 与 Task 重复公共事实。Delivery 则过于自由，脚本只能证明“写了内容”，不能识别明显的章节错填。

## 目标与范围

### 目标

- 固定设计维度和标题全部保留，只压缩重复表达。
- Delivery 保留五节，但关键语义字段化并由 draft 自动生成 Git/AC 骨架。

### 本次包含

- Design / Task 模板去除无意义空表，明确“无变化。”写法。
- 文档契约增加“不减结构、只减重复”的规则。
- Delivery draft 自动生成交付结果、AC 验证行、自审/剩余/快照固定字段。
- Delivery validator 校验字段枚举、AC 覆盖和明显不可验收状态。

### 本次不做

- 不修改 self-hosting 规则。
- 不减少 Design / Task 的固定设计维度。
- 不让 Worker 的“通过”自动替代 Main Acceptance。

## Requirements

- **R01**：Planning 必须保持结构化覆盖所有固定维度。
- **R02**：Delivery 必须让 Main 快速判断文件、AC、偏差、未验证项、风险和快照影响。

## 行为与验收标准

### AC-01｜固定结构下减少重复

- **行为**：Design / Task 的固定维度仍全部存在；无变化维度可直接写“无变化。”，不再生成空表或重复说明。
- **验证**：模板与 readiness 回归证明固定标题仍存在，简写“无变化。”可通过，缺少固定维度仍拒绝。

### AC-02｜Delivery 草稿自动结构化

- **行为**：deliver --draft 自动生成真实 Git 文件行、Task 引用的全部 AC 行和固定字段骨架。
- **验证**：草稿测试核对 Git diff、AC 顺序和字段模板。

### AC-03｜Delivery 明显错误可机械拒绝

- **行为**：最终 Delivery 必须使用固定结论/结果/快照范围；AC 必须逐一覆盖且不重复；存在未验证项、失败 AC 或契约偏差时不得声明总体“通过”。
- **验证**：正反例 validator 测试全部通过；Main Acceptance 仍保持显式判断。

## 约束与待确认

### 已确定约束

- 文档首先服务人类 Review。
- “无变化。”是明确覆盖声明，不是缺失。
- 公共设计只在 Design 展开，Task 只引用并写本地落实。
- 表格和正文不重复表达同一事实。

### 待确认

- 无。

## 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | SDD Planning / Delivery |
| 应用 / 组件 | templates、readiness、delivery draft / validator |
| Domain | 无变化 |
| Database | 无变化 |
| API / Protocol | Delivery Markdown contract 收紧 |
| Operations | 无变化 |

<!-- SDD:EVIDENCE:BEGIN -->
## 验证结果

pending

## 最终结论

pending
<!-- SDD:EVIDENCE:END -->
