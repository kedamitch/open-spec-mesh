# 技术架构总览

## 系统范围

Open Spec Mesh 是 Node.js 辅助工具、宿主 Adapter、角色和 Markdown Skills 的本地工具包。无审批服务或业务数据库；已退出自动 SDD 生命周期。经用户明确确认退出自托管 GPU 能力，仅保留 Node.js HTTP/MCP 客户端对接外部服务；第一方源码、测试与 CI 不再使用 Python。

## 组件与职责

| 组件 | 职责 |
| --- | --- |
| 当前 Agent / 角色 | 人工确认、宏观设计、串行实现；并行才 Worker/worktree；调查角色只读 |
| 文档工具 | 需求/设计/任务渐进生成、编号/导航、辅助检查 |
| 安装器与 Host Adapter | 三宿主受管配置、模型/用户资产保全和升级回滚 |
| 观测与诊断 | 只读证据、历史 Graph 兼容、SQLite 与私有 ZIP，不反向调度 |
| System One | 显式且默认关闭的 Node MCP/HTTP 客户端与语义建议，不构成人工授权 |
| Git / 项目验证 | 普通差异、worktree 隔离和实际验证命令，不生成执行身份 |

## 技术栈与公共边界

Node.js 22.0.0+、ESM、Git、TOML/JSON/Markdown、Mermaid；锁与原子写入保护资源，安全路径与受管 ownership 防止越界覆盖。正式流程无新机器 Graph/摘要/receipt；历史字段可用于只读诊断而非授权。Codex 保持角色模型/effort；其他宿主继承用户模型。

入口：[API](T02-api.md)、[存储](T03-database.md)、[领域模型](T04-domain-model.md)、[主时序](T05-diagrams/T05-03-main-sequence.md)、[运维](../04-operations/O01-operations-overview.md)。

## 通用规则与只读检查

通用规则单源为 sdd-init/references/workflow-policy.md；脚本维护共享副本和根 AGENTS 受管区域，保留区域外用户内容。安装器直接读取单源，不向下游复制本仓库专用发布规则。inspect-host 为按需文件核验；evaluate-collaboration 为确定性动作检查，均不变更授权、自动调度或推理。usage 和返工报告仅说明选定范围的证据，SQLite schema 不变。
