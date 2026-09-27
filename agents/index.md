# 角色配置

各角色 TOML 是角色 description、模型、effort、权限与提示词的唯一事实源；`config.toml` 中 description 只允许镜像，CI 校验一致。

| 角色 | 配置 |
| --- | --- |
| Architect | [architect.toml](architect.toml) |
| Worker | [worker.toml](worker.toml) |
| Reviewer | [reviewer.toml](reviewer.toml) |
| Explorer | [explorer.toml](explorer.toml) |
| Librarian | [librarian.toml](librarian.toml) |

[派发契约](dispatch-contract.md) · [主代理流程](../AGENTS.md) · [运行指南](../sdd-init/references/runtime-guide.md)
