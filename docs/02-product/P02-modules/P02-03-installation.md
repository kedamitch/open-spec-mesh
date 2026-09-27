# 安装与升级

## 模块定位

把同一 Open Spec Mesh runtime 安装到 Codex、OpenCode 或 Claude Code 的原生配置目录；不管理业务工程，也不接管用户模型/provider。

## Host 布局

| Host | 默认 Home | Rules | Skills | Agents | Open Spec Mesh MCP |
| --- | --- | --- | --- | --- | --- |
| Codex | `$CODEX_HOME` / `~/.codex` | `AGENTS.md` | `skills/` | `agents/*.toml` | 合并到受管 `config.toml` |
| OpenCode | `$OPENCODE_CONFIG_DIR` / `~/.config/opencode` | `AGENTS.md` | `skills/` | `agents/*.md` | `open-spec-mesh.opencode.json` overlay |
| Claude Code | `$CLAUDE_CONFIG_DIR` / `~/.claude` | `CLAUDE.md` | `skills/` | `agents/*.md` | `open-spec-mesh.mcp.json` overlay |

## 功能与业务规则

| 场景 | 操作 | 结果与边界 |
| --- | --- | --- |
| Codex 默认 | `install.sh` | 保持历史兼容 |
| 显式宿主 | `--host opencode|claude` | 安装宿主原生 Rules / Skills / Agents |
| 自定义 Home | `--host-home <path>` | 安装到显式配置根 |
| 项目资料 | `--include-project-docs` | 显式安装包参考 docs；默认不碰业务 docs |
| 用户配置 | 安装 / 升级 | 非 Codex 不解析/重写用户 provider、model、plugins 或 settings |
| 同名未受管资产 | 非 Codex 安装 | 拒绝覆盖；必须由用户先处理冲突 |
| Research MCP | 默认检测/安装；`--skip-tools` 可跳过 | package-owned overlay 只引用环境变量名 |
| dry-run | `--dry-run` | 完整预检，不写目标 |
| 升级失败 | 事务回滚 | 恢复本次已移动受管文件，不删除未受管文件 |

OpenCode / Claude 的 host manifest 只声明 Open Spec Mesh 自己拥有的路径，重复安装幂等。Rules 文件使用 managed marker 合并，用户正文保留。

## 模型与 Provider

Codex 延续现有 Role TOML model / effort。OpenCode / Claude 生成的 Agent 不写 Codex 模型名，默认继承宿主/用户当前模型。安装器不会读取、复制或迁移模型凭据。

## 可选 System One

本次多宿主适配只覆盖核心 SDD + Research MCP。托管 Laya/System One bridge 仍只在 Codex host 支持；OpenCode / Claude 请求 `--with-laya` 必须 fail closed，而不是生成不完整配置。

操作见 [本地工具包](../../04-operations/O02-applications/O02-01-local-toolkit.md)。
