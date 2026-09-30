# Operations Overview

## Environments

| Environment | Purpose |
| --- | --- |
| 开发工作站 | 运行安装器、Codex/OpenCode/Claude Code 与 SDD CLI |
| Host config home | 保存 Open Spec Mesh 受管 Rules / Skills / Agents / overlay |
| 业务项目工作区 | 保存代码、docs 与 SDD Git worktree |
| 外部 Provider | 提供模型推理；不属于本包部署单元 |

## Deployment Architecture

[部署架构图](O03-diagrams/O03-01-deployment-architecture.md)。

本包是按需执行的本地工具集，独立常驻业务应用数为 0。

## Configuration

| Host | 用户配置 | Open Spec Mesh 受管内容 |
| --- | --- | --- |
| Codex | `config.toml` | 受管 role/MCP 合并 |
| OpenCode | `opencode.json(c)` 等 | `AGENTS.md` marker、Skills、Agents、独立 overlay |
| Claude Code | `settings.json` 等 | `CLAUDE.md` marker、Skills、Agents、独立 MCP JSON |

Provider / 工具密钥只通过环境变量继承，不写入仓库或 overlay 值。

## Network

本包无固定监听端口。Research MCP / Provider 网络行为由用户环境决定；runtime smoke 不进行模型调用。

## Observability

- Logs：CLI stderr/stdout、Git、CI。
- Trace：人工确认、宏观 Task、实际 Git diff、验证与 Delivery；旧身份字段仅分析历史。
- Codex native rollout：可做 full observation。
- OpenCode/Claude private trace：当前标记 unsupported/partial，不伪造事件。

## Backup & Recovery

- Git 是代码和正式文档恢复基础。
- 安装器对受管文件使用暂存/替换/回滚。
- 非 Codex 未受管同名资产拒绝覆盖。
- Worker workspace 不自动 reset/rebase；宿主不得创建第二层 worktree。

## Security

- 密钥不写 docs、日志或受管配置值。
- Agent/permission 是宿主安全约束；文档校验是建议，Git diff 与测试结果由当前 Agent 真实核实，不使用自动生命周期门禁。
- 外部 Web/MCP 证据不获得代码写权限。

## Common Operations

[本地工具包运行说明](O02-applications/O02-01-local-toolkit.md)。
