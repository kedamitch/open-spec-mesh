---
name: sdd-close
description: 基于已验收和已集成结果完成收口检查，并在需要时同步受影响 Current Truth。
---
# 验收与收口

**输入**：Change、集成 revision、完整 diff、历次 Delivery / Task history、实际 AC 结果。不只看最后一轮返工。

## 收口控制

1. 核对 Task 定向验证并作出验收判断后，用 `open-spec-mesh sdd close "$CHG" --accept --reason ...` 登记接受；入口不会自动合并代码。
2. Main 对当前 accepted/pending wave 优先运行 `open-spec-mesh sdd integrate --wave --check` 做整波只读链式预检，再用 `open-spec-mesh sdd integrate --wave` 批量集成；单 Task 调试/恢复仍可使用 `--task`。脚本以 Git ancestry 判断结果是否已进入 HEAD，并用保留 `result_revision` ancestry 的 merge commit 集成；存在依赖时按 wave 推进，上游 revision 未进入 HEAD 不派发下游。简单冲突由 Main 解决；复杂冲突可回派原 Worker 之一修复，不新增业务 Task。
3. 最终集成稳定后，Main 将 integrated diff、历次 Delivery 和验收结果交 Architect 同步受影响的产品 / 技术 / 运维 Current Truth；Architect 只写真实影响，Main 核对并提交，使实现与 Current Truth 落在同一个最终 HEAD。
4. 最终全量验证前退役已完成 Worker 的 Git worktree 并 `git worktree prune`。只移除已提交且 Delivery 已导入/验收的干净 worktree；发现未提交实现或证据时先保全并停止，禁止 `--force` 丢弃。这样最终测试不会继承已结束 Worker 的 Git worktree 元数据。
5. 将该 HEAD 作为 `integrated_revision`，执行 `open-spec-mesh run-validation "$CHG" --root "$PROJECT" --revision "$INTEGRATED_REVISION"`。脚本只调用项目 `Q01-validation.md` 声明的单一版本化 Validation Entry Point；该入口必须已提交到待验证 revision，执行期间不得改 HEAD 或项目工件，并负责完成**全量测试 + 全量 build + 全局 static validation**。任一检查失败都必须修到通过；不维护存量失败、已知失败或 baseline failure 豁免。实现或 Current Truth 再变化时必须更新 revision 并重新验证。
6. receipt 通过后，只补 active Change 内的 `product / technology / operations` 评估、人类可读验证摘要和最终结论，再用 `open-spec-mesh sdd close "$CHG" --root "$PROJECT" --archive`。归档重新核对 receipt，并拒绝验证后 active Change 之外的任何项目变化；自然语言 `pass` 不能替代 receipt。

## 快照编辑

收到 Current Truth 同步任务时，只依据已集成 revision、完整 diff 和真实验收结果更新受影响快照。按内容引用公共 [产品](../sdd-init/references/product-writing.md) / [技术](../sdd-init/references/architecture-writing.md) 参考；不要把未实现方案、历史计划或猜测写成当前事实。

`--accept` 不代表已集成或已归档；`--archive` 不自动验收、执行验证、填写 pass 或修改快照。全量验证存在任一失败时最终结论不得写 pass；不接受“这是历史失败”作为豁免。receipt 用于防误操作和陈旧结果，不是用户身份认证或远程执行证明。检查失败保留 active；全量验证失败时修复后重跑，局部问题可回派原 Worker。实现与 Contract 冲突时停止，不降低 AC。发布准备按需使用 `sdd-release`。

本 Skill 只描述收口动作，不定义全局 Agent Routing。
