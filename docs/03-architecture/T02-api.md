# 接口定义

## 公共约定

本项目没有业务 HTTP 服务；入口是 CLI、Skill 和宿主 Agent 配置。脚本失败返回非零，错误不得解释为验收成功。项目路径使用 `--root`，Git revision 必须可解析为 commit。

## Host / Installation CLI

| 接口 | 输入 | 输出与边界 |
| --- | --- | --- |
| `install.sh` | 默认 Codex | 保持旧安装语义 |
| `install.sh --host opencode|claude` | 显式 host；可选 `--host-home` | native Rules / Skills / Agents + package-owned MCP overlay；不改用户 model/provider |
| `run_leaf.py --host ...` | role、prepare workspace、prompt、可选 exact session id | Codex exec / OpenCode run / Claude print-mode；不创建宿主 worktree |
| Host Adapter | canonical Role/Rules/Skill path | host-native Markdown/frontmatter/permissions；非 Codex model=inherit |

## SDD 日常 CLI

入口仍为 `sdd-change/scripts/sdd.py`，三宿主共享同一生命周期。

| 动作 | 输出与边界 |
| --- | --- |
| status | planning_ready、Task state/dependencies、session、allowed_actions |
| prepare | 冻结 Contract，生成 workspace/baseline/attempt/dispatch |
| bind-session | 绑定宿主 exact session/thread ID；不可改绑 |
| deliver --draft | 自动生成 Git 文件和 AC 骨架 |
| deliver | 校验 Path Contract、结构化 evidence 与 blockers |
| close --accept | Main 显式验收；机械 blocker fail closed |
| integrate --task / --wave | Git ancestry 驱动的预检/集成，不新增 Graph state |
| run_validation.py | 绑定最终 revision 的真实 Validation Entry Point receipt |
| close --archive | 复核 ancestry / receipt / frozen artifacts 后归档 |

## Host session 语义

- Codex leaf：独立 `codex exec`，resume 使用 exact thread UUID。
- OpenCode leaf：`opencode run --agent <role>`；resume 使用 exact session ID；工作目录由 launcher cwd 固定为 SDD workspace。
- Claude leaf：`claude -p --agent <role>`；resume 使用 `--resume <id|name>`；通过 `--mcp-config` 加载 package overlay。
- Host session ID 是恢复标识，不是身份认证。

## 离线观测 CLI

`observe.py --host codex|opencode|claude`。Codex 支持 full trace collect/scan；OpenCode/Claude 当前 artifact-only collect 并明确 partial，非 Codex scan fail closed。数据库默认使用宿主无关 Open Spec Mesh state home。

## 可复用语义判断

System One/Laya 为可选能力。本次多宿主适配不扩展其托管 bridge；Codex 行为保持，非 Codex `--with-laya` 显式拒绝。
