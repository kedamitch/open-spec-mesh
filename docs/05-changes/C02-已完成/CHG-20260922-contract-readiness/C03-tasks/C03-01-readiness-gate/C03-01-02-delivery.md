---
status: submitted
revision: fd2784fc244d72d3fbca717b645f7b1fa0691f6a
attempt: 1
baseline: 8f7a69cb34b09a8c1e41e0c70b4cea3887e3f229
---

# Task Delivery

> **历史迁移说明**：原 Task ID 为 `C02-01`；2026-09-26 仅迁移文档编号和结构，原实现 revision、baseline、attempt 与验收事实不变。

## 文件改动

| 文件 | 操作 | 改动点与行为影响 |
| --- | --- | --- |
| `sdd-change/scripts/contract_readiness.py` | A | 共用正文、占位、AC 定义和引用检查；允许紧凑句式、表格、合法领域值与示例 |
| `sdd-change/scripts/workflow.py` | M | approve 复用完整性检查，支持无 Task 时共用入口；错误保留文件位置与既有 Design 提示 |
| `sdd-do/scripts/prepare_workspace.py` | M | 在创建工作区、递增 attempt 前复查完整性，拒绝历史或伪造的无效摘要 |
| `sdd-close/scripts/check_change.py` | M | 纯文档和有 Task 的收口都检查契约完整性，不改变证据、摘要和集成约束 |
| `tests/test_contract_readiness.py` | A | 19 项真实生命周期正反例，覆盖失败无副作用、AC 引用和合法文本 |

## 验证结果

**结论**：通过。原实施版本为 `fd2784fc244d72d3fbca717b645f7b1fa0691f6a`。

| 验收 / 场景 | 实际检查 | 结果与证据 |
| --- | --- | --- |
| `AC-01` / `AC-02` | `python3 -B -m unittest discover -s tests -p test_contract_readiness.py -v`；真实 Git 图前后字节比较 | 初始 12 项在旧实现上 9 项失败，修复后通过；后续补齐为 19 项 |
| `AC-03` | prepare 与无 Task close 反例 | 拒绝无效输入，未创建 worktree、未归档，图字节不变 |
| `AC-04` | 中文紧邻 AC、领域值、inline comment、metadata / evidence、实际 Design+Mermaid | 通过；未改变 digest 算法 |
| `AC-05` | `python3 -B -m unittest discover -s tests -v` | 126 项通过 |
| `AC-05` | `python3 -B agents/test_validate_agents.py`；`python3 -B agents/validate_agents.py` | 3 项通过；角色配置有效 |
| `AC-05` | `python3 -B sdd-init/scripts/validate_docs.py --root .`；`bash -n install.sh`；安装 dry-run | 通过 |

## 自审结论

按 review-checklist 对照 Contract、5 个实现文件和测试。补修了错误优先级、中文紧邻 AC 引用、纯引用块、空断言和带说明的占位前缀。未扩大 Graph schema、审批或模型范围；失败检查位于状态/工作区写入之前。

## 剩余问题

本次由当时会话实施与自审，未调用独立 Reviewer。解析只检查文档结构与引用，不证明需求语义或测试充分性。

## 快照影响

已在集成验收后更新产品 Runtime、CLI、领域 planned 条件、主时序中的批准失败分支及 Task 使用说明。2026-09-26 的编号迁移只改变文档结构，不改变这些历史产品/技术事实。
