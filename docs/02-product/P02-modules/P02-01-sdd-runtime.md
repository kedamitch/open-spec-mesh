# SDD Runtime

## 模块定位

以 Change 保存意图，以 Git 和 Task 保存执行身份；日常收敛为准备、交付、收口三个动作，不新增调度服务或状态机。

## 功能与规则

| 能力 | 行为与边界 |
| --- | --- |
| Quick | Main 连续完成；可用 Explorer / Librarian 调查；不建 Change / Task，不调用 Worker |
| SDD Change / Design | Architect 直接定义；Design 只保存跨 Task 公共设计、公共不变量、Task 关系与设计落点 |
| 项目文档迁移 | 新项目用 sdd-init；已有旧 docs 项目用 sdd-migrate 先保留原字节到 `.sdd-migration/legacy-docs/`，再人工映射到 canonical Current Truth / ADR / Research / Change |
| SDD Task Graph | Architect 直接生成；Graph 只保存 Task 路径、依赖、状态和运行元数据，AC/验收语义留在 Change / Task Contract；Design 映射全部 Task 并说明依赖/协作关系 |
| Main | 校验、冻结、按 Graph 派发和验收；不重新拆分、合并、改写或转译 Task |
| 并行 | Task 按业务模块拆分；依赖满足后可在独立 worktree 并行，Path Contract 可合理重叠；高重合或真实先后依赖才串行 |
| 派发 | 复用原冻结、基线和 attempt 检查；运行中的同一 Task 返回恢复信息，不生成新 attempt 或第二个执行 |
| Delivery | 可生成精确 Git 文件表草稿；实际 diff 必须符合当前 Task Path Contract；Worker 只提交定向测试、必要 build/static、自审和剩余问题 |
| 验收 | Main 明确判断后自动 submit 或导入指定 worktree 报告；Worker 写报告不直接推进权威任务图 |
| 集成 | `status` 用 Git ancestry 推导 pending / integrated；单 Task 可用 `integrate --task`，同一 accepted/pending wave 可用 `integrate --wave --check` 一次链式预检、再用 `integrate --wave` 批量 ancestry-preserving 集成；wave 候选按 Graph 顺序派生，不新增持久状态；简单冲突由 Main 处理，复杂冲突回原 Worker；最终集成后交 Architect 同步 Current Truth，再对最终 HEAD 做全量验证 |
| 收口 | run_validation 将入口真实退出结果绑定最终 integration revision；归档拒绝缺失/失败/陈旧 receipt，以及验证后 active Change 之外的任何项目变化 |
| 恢复 | 普通 rework 保持契约；漂移先获用户确认再由原 Architect 修订并 replan |

SDD Task Contract 是 Task 本地详细设计的唯一事实源，并显式列出 Path Contract、`depends_on / AC / Dxxx`；这些引用必须与 Design Task 行及 Graph 一致。Path Contract 留在 Markdown，不进入 Task Graph schema，也不用于判断兄弟 Task 是否能并行。完整 Design 和全部 Task Contract 必须在实现前一次性完成，便于先 Review 再执行。冻结按 Task 实际引用收窄：公共 Change/Design 仍共享，未引用的其他 AC / Dxxx 不直接使当前 Task stale。

日常命令见 [运行指南](../../../sdd-init/references/runtime-guide.md)，低层与恢复命令见 [Task 协议](../../../sdd-change/references/task-graph.md)。结构校验不证明业务语义或测试陈述真实。
