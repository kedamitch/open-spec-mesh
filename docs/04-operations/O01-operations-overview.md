# Operations Overview

## Environments

| Environment | Purpose |
| --- | --- |
| 开发工作站 | 运行安装器、Codex 客户端和 SDD CLI |
| 业务项目工作区 | 保存代码、docs、Git worktree 和项目私有配置 |
| 外部 Provider | 提供模型推理；不属于本包部署单元 |

## Deployment Architecture

[部署架构图](O03-diagrams/O03-01-deployment-architecture.md)。

本包是按需执行的本地工具集，独立常驻业务应用数为 0。

## Configuration

- Codex / Agent：`config.toml`。
- Provider / 工具密钥：外部环境变量。
- 业务应用：真实 `.env` 外置，不进入仓库或镜像。

## Network

本包无固定监听端口。可选 MCP / 外部 Provider 的地址由用户配置；业务项目端口在各自应用文档维护。

## Observability

### Logs

CLI 标准输出 / 错误和 Git / CI 记录。

### Metrics

正常 SDD 流程不要求额外模型指标；离线 Observation 可按执行记录生成确定性统计。

### Tracing

Task ID、baseline、attempt、revision、Delivery 和 history 提供研发链路追踪。

### Alerts

本包无常驻告警服务；CI 失败和 CLI 阻断由调用方处理。

## Backup & Recovery

- Git 是代码和正式文档恢复基础。
- 安装器对受管配置使用暂存 / 替换 / 失败恢复。
- Worker workspace 不自动 reset / rebase，避免隐式丢代码。

## Security

- 密钥只通过宿主环境传递，不写 docs、日志或受管配置值。
- 不把命令行确认 flag 当身份认证。
- 外部 Web / MCP 证据不获得代码写权限。

## Common Operations

[本地工具包运行说明](O02-applications/O02-01-local-toolkit.md)。

业务项目的 Docker 交付规则见 [运维模板](../../sdd-init/references/operations-template.md)；不存在的服务不创建 Dockerfile。
