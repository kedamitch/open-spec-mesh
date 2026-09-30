# C03-03｜观测与语义工具兼容：实施记录

> 2026-09-29，当前 Agent 串行实施；相关能力已实现并通过 Node 回归，待用户确认。

## 实际结果

观测工具支持无 Graph、plain Markdown index 的人工 Change，缺少旧自动工件不再构造异常失败；旧 Graph/history/session/rollout 保持只读兼容。模式支持 Quick 与 semi-auto，legacy sdd 仅兼容历史标签。

诊断包保留原始数据和事实/推断边界；人工流程不再因为没有 prepare/冻结链而推断缺陷，不写状态或替用户审批。

System One 角色建议不再以完整/ready Graph 自动允许 Worker：只有明确 implementation_authorized 且 execution_strategy=parallel 才可建议 Worker；串行仍由当前 Agent 完成，Reviewer 要有 reviewer_requested。执行模式模板采用新语义，旧 wire fixture 保留兼容。

## 验证与自审

observation、diagnostics、System One 回归通过。真实 MCP SDK stdio client 的两项协议测试通过，安装后的 Node wrapper 实际解析相邻 runtime 并列出/调用四个低层工具；没有调用真实模型、GPU 或认证 Provider。

历史数据库 scope-key/整数/text envelope 等兼容回归保留；没有 Node 包装 Python，也没有把 HTTP 客户端冒充 GPU 引擎。

## 剩余边界

GPU 服务没有迁移完成。社区 Node 后端线索不足以证明跨 state 真批量、拒绝截断和 strict-CUDA 行为；不新增未验证推理依赖，不下载模型，不伪造服务等价。

## 2026-09-29 后续：GPU 退出已确认

本记录正文保留 GPU 授权前的实现结果、未决项及失败证据。用户后续已明确允许删除自托管 GPU，服务与专属 Python 测试/CI/依赖现已退出；最新核心完整验证 exit=0，9 项检查与 163 项 Node/Agent 回归通过，Python=0。最新事实见 [C03-05 实施结果](../C03-05-node-gpu-service/C03-05-03-delivery.md)。此前 core 失败不再是当前结果；扩展验证尚未全绿，不把核心通过当作最终人工验收。
