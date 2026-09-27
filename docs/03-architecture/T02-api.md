# 接口定义

## 公共约定

本项目没有 HTTP 服务；入口是 CLI、Skill 和角色配置。脚本失败返回非零，错误不得解释为验收成功。项目路径使用 `--root`，Git revision 必须可解析为 commit。

## 日常 CLI

入口为 `sdd-change/scripts/sdd.py`；成功返回 JSON，复用既有生命周期与存储格式。

| 动作 | 输入 | 输出与边界 |
| --- | --- | --- |
| status | Change；可选 Task | `planning_ready`、Task 状态/依赖、`agent_session` 和 `allowed_actions`；只报告机械允许动作，不替 Main 做语义路由 |
| prepare | Change；可选 Task、base、worktree、reuse | 契约路径、Task、baseline、attempt、workspace、digest、`allowed_actions` 与 Worker `dispatch` Packet；多 Task 拒绝猜选 |
| prepare 恢复 | 当前 running Task | 原身份、resume=true、原 `agent_session`；不增加 attempt，不替换原 Worker 或工作区 |
| bind-session | running Task、spawn 后得到的 Agent session/thread ID | 首次绑定可恢复会话；重复同值幂等，不允许改绑另一个会话 |
| deliver --draft | 已提交 revision、派发 attempt、证据文件路径 | 精确 Git 文件表和待填写章节；拒绝覆盖已有文件、陈旧身份和符号链接 |
| deliver | 当前 revision、派发 attempt、完整证据文件 | 当前 Delivery 路径；用真实 Git diff 校验 Task Path Contract；Worker 不更新权威 submitted / accepted 状态 |
| integrate --task [--check] | accepted Task | 单 Task Git ancestry 幂等判断；`--check` 在 detached worktree 预检真实 merge，实际执行以 Task `result_revision` 为 parent 创建 ancestry-preserving merge commit；保留 Main 当前 active Change 权威快照，冲突不静默改写 |
| integrate --wave [--check] | 当前 accepted/pending wave | 按 Graph 顺序派生候选；在一个 detached worktree 中链式预检整个 wave，可发现 Task 间冲突且不改 Main HEAD；无冲突时批量复用单 Task ancestry-preserving 集成，重复执行只处理剩余 pending |
| close --accept | 当前 Task、Main 验收理由 | 自动 submit / 导入原工作区报告后登记 accepted；不合并代码 |
| `run_validation.py` | Change、integration revision | 调用项目唯一 Validation Entry Point；先使旧成功 receipt 失效，再记录 revision / 入口摘要 / 退出码 / 输出摘要；不通过 LLM 文本判定成功 |
| close --archive | 已完成集成、机器验证 receipt 全绿并完成评估的 Change | 复核 receipt、集成祖先、冻结 Contract/Report 和最终结论后归档；不隐式执行验证、验收、填 pass 或写快照 |

单 Task 可省略 `--task`，多 Task 必须指定。`--accept --archive` 可组合，但两组前提均需满足；后一步失败保留前一步有效状态，不误报归档完成。参数与操作见 [运行指南](../../sdd-init/references/runtime-guide.md)。

## 生命周期与恢复接口

- **创建**：new_change 一次性创建 C01 Change、C02 Design、C03 Tasks/Graph；new_task 只在 C03-tasks 下创建 canonical Task Design / Delivery。旧布局和 `--from-change` 不支持。
- **冻结与状态**：task_graph 保留 approve、submit、block、rework、replan；`status` 只读暴露合法下一步，并以 Git ancestry 派生 accepted Task 的 integration 状态；`bind-session` 只补运行元数据；均不跳过 readiness、漂移或用户确认检查。
- **派发与交付**：prepare_workspace、record_delivery、import_delivery 保留原工作区、版本、attempt 和文件表校验；Delivery/导入/submit 都复验 Task Path Contract。
- **集成、验收与归档**：record_acceptance 保留 Task 验收；integrate 用真实 Git merge 与 ancestry 完成 wave 集成且不新增 Graph 状态；run_validation 将项目单一验证入口的实际退出结果绑定到 integration revision；check_change / close_change 复核 receipt、契约、报告摘要、真实集成祖先关系和最终结论。

低层命令见 [Task 协议](../../sdd-change/references/task-graph.md)。角色名称和命令行确认标记不是身份认证；实际权限仍由宿主与调用方保证。

## 离线观测 CLI

`python3 -B sdd-do/scripts/observe.py [--db <private-db>] <command>`；不会执行日志里的命令，不访问网络或模型。

| 命令 | 输入与输出 | 关键边界 |
| --- | --- | --- |
| collect | 指定 rollout、可选 turn/Change/期望模式与角色 → 私有观测库 | 多 turn 必须选择；只导入显式关联子会话 |
| scan | 项目、sessions 目录、可选 UTC 起始日期 → 分片 run_id | 默认 100 片段，未知/重复文件不静默合并 |
| report | run_id → Markdown 或 JSON | 当前快照与运行时指令证据分开 |
| group | 显式成员 run_id → 最终需求视图 | 拒绝重叠片段；同 Change 状态用最新快照，不累计重复历史 |
| summary | 库内执行片段 → 版本分组与问题计数 | 分子/分母、unknown 可见；分组视图不重复计数 |

完整参数、适配范围与诊断口径见 [observation](../../sdd-do/references/observation.md)。命令失败非零；不写 Task 状态、不阻断实际开发，也不伪造已完成。

## 可复用语义判断

MCP：laya_templates 列模板；laya_decide 接收版本化 ID、items 和共享 context；laya_predict 用于模板原型；laya_status 只用于显式排错。数据协议、范围和示例见 [运行协议](../../typesafe-laya/references/runtime.md)。

MCP/CLI 所有推理固定使用 `/v1/systemone/batch`，接收 requests 数组，按输入顺序返回等长 results；单条也包装成一个条目。客户端无需路径配置，不尝试旧接口。服务端内部 Router.predict_batch 使用单线程执行器并限制待处理量；原 `/v1/systemone` 保留供其他客户端使用。

返回建议不执行动作。模型候选、字段类型和概率范围由代码校验；uncertain 或失败回到原角色。缓存仅在明确固定模型版本时跨请求启用，最长 60 秒。可选指标仅保存哈希和聚合计数；不记录原始输入与凭据。
