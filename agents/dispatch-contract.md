# 派发契约

固定 Role Prompt + 当前 Dispatch Packet。公共派发层不维护全局 Routing Graph；调用方只从自己角色说明允许的 delegate 中选择，不要向子 Agent 注入无关全局角色拓扑。

## 最小上下文

- `mode`：quick / sdd（SDD 模式）；旧 semi-auto 仅作兼容别名，不是第三种模式。
- `goal`：当前任务目标。
- `scope`：业务范围，不是文件白名单。
- `known_facts`、`unknowns`：已知与待核实事实。
- `constraints`：安全、兼容与用户授权边界。
- `expected_output`：需要的结论与证据。

并行实现补充宏观 Task/Design 引用、真实依赖结果、worktree 和 Git 起点、必要验证与 Delivery；不需要自动 prepare、digest、attempt 或绑定身份。新 Agent task_name/可控标题使用 role_desc，如 explorer_module_flow、worker_document_tools。agent_type 仍是固定角色。历史会话保留名称，优先恢复，不重做已确认工作。

返回 status / result / evidence / artifacts / blockers；工具通过不构成人工确认，变化按真实语义处理。
