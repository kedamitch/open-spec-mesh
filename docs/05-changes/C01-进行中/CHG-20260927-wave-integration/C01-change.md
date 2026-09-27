---
integrated_revision: pending
product: pending
technology: pending
operations: pending
---
# 变更说明

> **目标**：让 Main 用一次命令安全预检或集成当前 accepted/pending integration wave，并让离线 observation 精确记录 wave 级动作。

## 背景与问题

当前 `sdd.py integrate` 已能可靠集成单个 accepted Task，但同一 wave 有多个 accepted Task 时，Main 仍需逐个选择 Task、逐个预检、逐个集成。重复操作增加遗漏和中断恢复成本；observation 目前也只识别单 Task integration。

## 目标与范围

### 目标

- 提供显式 wave 级集成入口，减少 Main 的重复机械操作。
- 保持 Git ancestry 为 integration 唯一事实源，不给 Task Graph 增加新状态。
- wave 操作在冲突、重复执行和会话恢复时保持可解释、可重复。

### 本次包含

- `sdd.py integrate CHG --wave [--check]`。
- 当前 wave 的确定性候选选择、全 wave 预检和顺序集成。
- observation 对 wave preflight / integration 的独立事件分类。
- 对并行 accepted Task、冲突、幂等和无候选场景的回归测试。

### 本次不做

- 不自动解决 merge conflict。
- 不自动接受 submitted Task。
- 不修改 Task Graph schema 或 Task 状态集合。
- 不引入远程队列、后台调度或自动 Worker 编排。

## Requirements

- **R01**：wave 必须只包含当前 HEAD 尚未集成的 accepted Task，并按 Graph 顺序确定。
- **R02**：`--check` 必须只读预检整个 wave；发现任一代码冲突时不能改变 Main HEAD。
- **R03**：实际 wave 集成必须保留每个 Task `result_revision` 的 ancestry，重复执行幂等。
- **R04**：observation 必须区分 wave preflight 与 wave integration，不伪造内部逐 Task 阶段。

## 行为与验收标准

### AC-01｜当前 wave 选择稳定

- **行为**：存在多个 accepted 且 integration=pending 的独立 Task 时，wave 返回这些 Task；已 integrated、非 accepted Task 不进入候选。
- **验证**：构造多 Task 图并核对 wave 返回顺序、过滤结果和无候选结果。

### AC-02｜整波预检与集成安全

- **行为**：`integrate --wave --check` 对整个 wave 做链式预检且不改变 HEAD；实际 `--wave` 仅在整波预检通过后按确定顺序集成，并保留所有 result revision ancestry。
- **验证**：使用两个 worktree 结果验证 clean wave、worker 间冲突、幂等和最终 ancestor。

### AC-03｜Wave 事件可观测

- **行为**：离线 observation 将 `integrate --wave --check` 识别为 wave preflight，将 `integrate --wave` 识别为 wave integration；不展开成多个虚构 Task 事件。
- **验证**：command_fact 定向测试和 analyzer 成功命令计数回归。

## 约束与待确认

### 已确定约束

- Git ancestry 仍是 integration 事实源。
- 不新增持久 integration 状态。
- wave 失败不自动 rework/replan，也不降低 AC。
- 保持现有单 Task `integrate --task` 行为兼容。

### 待确认

- 无。

## 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | SDD Runtime / Observation |
| 应用 / 组件 | sdd.py facade、offline observation adapter |
| Domain | Integration Wave 派生概念，不新增持久状态 |
| Database | 无 |
| API / Protocol | CLI 新增 integrate --wave；既有参数兼容 |
| Operations | 无常驻服务变化；CI 回归覆盖 |

<!-- SDD:EVIDENCE:BEGIN -->
## 验证结果

pending

## 最终结论

pending
<!-- SDD:EVIDENCE:END -->
