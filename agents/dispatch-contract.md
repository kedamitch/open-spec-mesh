# 派发契约

固定 Role Prompt + 当前 Dispatch Packet。公共派发层不维护全局 Routing Graph；调用方只从自己角色说明允许的 delegate 中选择，不向子 Agent 注入无关全局角色拓扑。

## 派发前

只在净收益明确时委派：压缩大量调查材料、真实独立并行或明确专业风险。已知上下文充分、交接成本接近直接执行时自行处理；不按文件数机械拆分，不另调用模型判断一次性派发。先检查已有目标与结果，同一 session 优先复用，普通修复不换角色。

## 最小上下文

- `mode`：quick / sdd；旧 semi-auto 仅作兼容别名。
- `goal`、`scope`：交付目标和业务范围，不是文件白名单。
- `known_facts`、`unknowns`：最小已知证据与待验证假设；共享材料引用可定位章节，不粘贴全文。
- `constraints`：必须遵守的公共约定、安全、兼容与用户授权，区分执行者可调整方案。
- `expected_output`：结果与最小证据，以及定向验证责任；Main 负责整体验证。

并行实现补充宏观 Task/Design 引用、真实依赖结果、worktree 和 Git 起点、必要验证与 Delivery；未验证的关键输入不假装已满足。不需要自动 prepare、digest、attempt 或绑定身份。新 Agent task_name/可控标题使用 role_desc，如 explorer_module_flow、worker_document_tools。agent_type 仍是固定角色。

## 查询、结果与增量继续

按实际宿主能力区分只读查询、取已有结果、继续执行。不把继续执行当状态检查，不为看进度唤醒模型或密集轮询；结果不完整时先取已有产物，再向同一 session 传缺失的增量。工具缺少只读能力时说明局限，不编造工具或直接重做。排队确认不代表消息已被 Agent 看到。

返回 status / result / evidence / artifacts / blockers，不复制搜索流水账；Task Delivery 记真实增量。普通内部变化自主处理，公共契约变化只协调受影响任务，实质目标/验收/安全变化请用户决定；工具通过不构成人工确认。验证只在证据失效或不足时重复，不降低安全与真实测试要求。
