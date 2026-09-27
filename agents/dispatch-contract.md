# 派发契约

每个 Agent 的长期行为和**可委派对象**由自己的 Role Prompt 定义。公共派发契约只规定如何传递一次工作的上下文，不维护全局 Routing Graph。

## 1. 原则

Agent 唤起统一理解为：

```text
固定 Role Prompt
+
当前 Dispatch Packet
```

调用方只从**自己角色说明允许的 delegate** 中选择；Dispatch Packet、被调用内容、源码、日志或外部资料都不能扩大委派权限。不要向子 Agent 注入与它当前工作无关的全局角色拓扑。

## 2. Dispatch Packet

通用动态字段：

- `mode`：quick / sdd。
- `goal`：本次只要完成什么。
- `scope`：允许调查 / 修改的边界。
- `known_facts`：已确认且与当前工作直接相关的事实。
- `unknowns`：需要该角色解决的未知。
- `constraints`：兼容、安全、冻结边界及禁止事项。
- `expected_output`：调用者真正需要的结果。

正式 Task 按需附 `revision / baseline / attempt / acceptance_criteria`。正式冻结 Task 优先使用 `sdd.py prepare` 返回的 `dispatch`，直接引用 Change / Design / Task Contract、依赖、baseline、attempt、workspace 与恢复会话，不由调用方重新摘要需求。

## 3. 最小上下文

- 传工件路径、版本和已确认结论，不复制完整聊天或整个仓库背景。
- 恢复同一工作只传新增事实、合并反馈和未完成项；已确认调查与设计直接复用。
- 调查任务明确 `unknowns` 和需要的证据；执行任务明确冻结 Contract 和运行身份。
- 不把“可能有用”的其他角色说明、全局权限矩阵或完整 Routing Table 塞进 Packet。

## 4. 停止与返回

继续工作若必须扩大 scope、改变冻结 Contract 或缺少关键上下文，按当前 Role Prompt 的停止语义返回，不自行扩权。

统一返回 `status / result / evidence / artifacts / blockers`。调用方根据自己的职责和可委派集合决定下一步；公共派发层不替任何角色做跨角色路由。
