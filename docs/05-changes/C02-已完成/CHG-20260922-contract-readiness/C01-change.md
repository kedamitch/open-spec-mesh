---
integrated_revision: fd2784fc244d72d3fbca717b645f7b1fa0691f6a
product: 已同步 Runtime 派发规则；安装能力独立成模块，其他产品行为不变
technology: 已同步 CLI、领域条件、主时序与状态图；存储字段与审批协议不变
operations: 安装恢复归入本地工具单元；无新增应用、Dockerfile 或真实部署
---
# 变更说明

> **目标**：在执行前拒绝未完成或无验收依据的契约，避免无效方向被冻结后交给 Worker。

## 背景与问题

基线 `a4019ab` 的 `planning_complete` 只检查空文本和单一中文占位串，其他占位、纯标题或注释仍可能通过 approve。需要在不改变 Graph schema、状态机、digest 算法和审批语义的前提下，统一加强契约完整性检查。

## 目标与范围

### 目标

- approve / prepare / close 使用一致的 readiness 规则。
- 缺正文、占位、缺 AC 或 AC 引用错误时明确失败。
- 失败不得产生 Graph、attempt、workspace 等状态副作用。

### 本次包含

- Change / Task / Design 正文完整性检查。
- Change AC 定义和 Task AC 引用一致性检查。
- approve / prepare / close 接入统一 gate。
- 专项正反例和全量回归。

### 本次不做

- 不新增角色、模型或审批层。
- 不改变 Task Graph schema、状态机和 digest 算法。
- 不证明业务语义正确或测试充分性。

## Requirements

- **R01**：契约必须存在真实规划正文，标题、注释和示例不能代替正文。
- **R02**：Change 必须定义 AC，Task 只能引用存在的 AC。
- **R03**：readiness 失败必须在任何运行状态写入前返回。
- **R04**：合法领域值、代码示例和证据区内容不能被误判为未完成规划。

## 行为与验收标准

### AC-01｜拒绝未完成契约

- **行为**：Change、Task 或 Design 无实质正文，或规划正文仍含未完成占位时，approve 必须拒绝并指出文件/缺口。
- **验证**：真实临时 Git 仓库反例，并比较 Graph 前后字节确保无副作用。

### AC-02｜校验 AC 定义与引用

- **行为**：Change 缺 AC、AC 重复，或 Task 无 AC 引用 / 引用未知 AC 时拒绝派发。
- **验证**：覆盖有效 AC、重复 AC、未知引用和中文正文。

### AC-03｜防止绕过 Readiness

- **行为**：即使存在历史无效冻结摘要，prepare 和 close 仍必须重新执行 readiness；失败时不创建 worktree、不归档。
- **验证**：CLI / 函数集成反例，确认状态与工作区不变。

### AC-04｜避免合法内容误报

- **行为**：合法领域状态值、代码块 / 注释内示例、frontmatter 和 evidence 区不会被当作未完成规划。
- **验证**：专项覆盖这些文本形态。

### AC-05｜回归与集成通过

- **行为**：实现、自审、集成后既有回归全部通过，保留真实 Task 身份、逐文件 Delivery 与集成证据。
- **验证**：全量测试、角色 / 文档 / 安装检查和对应提交 CI。

## 约束与待确认

### 已确定约束

- 不自动修规格、不自动 replan。
- 不改变 Graph schema、状态集合、digest 算法和用户确认策略。
- 结构校验不能冒充业务语义校验。

### 待确认

- 无。

## 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | SDD Runtime 派发前增加契约完整性保护 |
| 应用 / 组件 | contract_readiness / workflow / prepare / close |
| Domain | Task 状态集合不变，只加强状态迁移前置条件 |
| Database | 无 |
| API / Protocol | CLI 命令不变，失败条件更严格 |
| Operations | 无新增应用或部署 |

<!-- SDD:EVIDENCE:BEGIN -->
## 验证结果

原执行记录中的 Task ID 为 `C02-01`；2026-09-26 统一文档结构后迁移为 `C03-01`。实现 revision、baseline、attempt 与验收事实不变。

| 阶段 | 实际执行 / 证据 | 结果 |
| --- | --- | --- |
| 准备 | new_change.py → new_task.py → task_graph.py approve | 契约与摘要先提交：`8f7a69cb34b09a8c1e41e0c70b4cea3887e3f229` |
| 派发 | prepare_workspace.py --worktree /mnt/data/sdd-worker | baseline 为规划提交；attempt=1 |
| 先红后绿 | 初始 12 项新测试在旧实现上 9 项失败；修复后扩充到 19 项 | 新旧差异有回归保护 |
| AC-01 / AC-02 | test_contract_readiness；Graph 字节比较 | 通过 |
| AC-03 | prepare 与 close 反例 | 通过；无状态副作用 |
| AC-04 | 中文 AC、合法状态值、注释 / 示例、metadata / evidence | 通过；digest 算法未变 |
| 实现 | 5 个代码 / 测试文件；见 [Delivery](C03-tasks/C03-01-readiness-gate/C03-01-02-delivery.md) | `fd2784fc244d72d3fbca717b645f7b1fa0691f6a` |
| AC-05 | 全量 tests + agent validation + docs/install checks | 通过 |
| CI | 对应实施提交的 GitHub Actions | 全部成功 |

限制：readiness 只证明结构与引用完整，不证明需求语义或测试充分性。

## 最终结论

pass
<!-- SDD:EVIDENCE:END -->
