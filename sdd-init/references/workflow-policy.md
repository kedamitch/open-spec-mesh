# 流程边界

模式选择与角色路由以 [工作约定](../../AGENTS.md) 为准；日常操作见 [运行指南](runtime-guide.md)。本页只补充交接、授权和完成边界。

## 交接与复用

- **Quick**：Main 连续实现；可按需委派 Explorer / Librarian 做只读调查。调查不等于 SDD。
- **SDD**：需要 Worker 执行、多个执行单元/并行执行，或需要先由独立 Planning Owner 形成持久化设计再实施时，Main 先交 Architect；Architect 是唯一 Planning Owner，直接产出 C01 Change + C02 Design + C03 Task Graph + 全部 Task Design。
- **设计重量**：由问题本身决定。简单任务保持最小设计；复杂任务再展开必要架构、状态、数据、接口、失败与兼容。不得为了进入 SDD 而固定增加文档重量。
- **最小上下文**：派发目标、契约入口、授权范围、baseline / attempt、已有结论和阻断项，不复制全仓或完整聊天。
- **连续闭环**：原 Worker 完成实现、定向测试、自审、修复和复验；反馈一次汇总。上下文无法恢复时只交接新增信息，不重做已有有效调查。
- **任务边界**：Main 不重新拆分、合并、改写或转译 Architect 的 Task Graph。Task 优先按业务模块拆分；Path Contract 只保护单 Task 写入边界，兄弟 Task 可有路径重叠。低/中度重叠使用独立 worktree 并行，高重合或真实先后依赖才串行。

## 授权边界

- **进入 SDD**：无额外模式审批；由是否需要 Worker 分工、多个执行单元、并行执行或独立规划决定。
- **Reviewer**：仅用户明确要求独立复审时启用，不是 SDD 默认阶段。
- **冻结契约变化**：返回 `contract_change_required`，停止相关写入和下游，等用户确认后才修订和 replan。
- **普通返工**：契约不变就 rework；不改规格、降低 AC 或改状态绕过检查。摘要检测文本而非语义，冻结后不顺手润色；意外漂移先恢复原文，确需修改再确认。

## 完成边界

交付 ≠ 验收，验收 ≠ 集成通过，归档 ≠ 发布。Worker 只证明当前 Task；Main 用确定性 integrate 按 wave 合并 accepted result，只有上游精确 revision 已进入 HEAD 才派发依赖 Task。全部 Task 最终集成后，Main 交 Architect 根据 integrated diff 同步 Current Truth 并提交，再运行项目完整测试 / build / static validation。最终验证必须全部通过，不维护“历史失败/已知失败”豁免；发现任何失败都修复或回派原 Worker，直到全绿后收口。

快照与实现不一致时定位原因，不能把错误实现转写为新需求；既有事实按授权同步，新取舍另行确认。状态和恢复命令见 [Task 协议](../../sdd-change/references/task-graph.md)；确认 flag 不是身份认证，角色说明不是文件系统 ACL。

- **集成与验证**：Main 先用 `sdd.py integrate --check` 预检，再用 `integrate` 保留 result ancestry；普通 merge conflict 由 Main 处理，复杂语义冲突回原 Worker。Worker 只做 Task 定向验证；最终集成与 Current Truth 同步提交后由 Main 跑完整验证，任何失败都修到通过。
