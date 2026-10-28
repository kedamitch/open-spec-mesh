# 安装与升级

## 模块定位

把同一 Open Spec Mesh runtime 安装到 Codex、OpenCode、Claude Code 或 DeepSeek Harness (DSH) 的原生配置目录；不管理业务工程，也不接管用户模型/provider。

## Host 布局

| Host | 默认 Home | Rules | Skills | Agents | Open Spec Mesh MCP |
| --- | --- | --- | --- | --- | --- |
| Codex | `$CODEX_HOME` / `~/.codex` | `AGENTS.md` | `skills/` | `agents/*.toml` | 合并到受管 `config.toml` |
| OpenCode | `$OPENCODE_CONFIG_DIR` / `~/.config/opencode` | `AGENTS.md` | `skills/` | `agents/*.md` + overlay `agent` map | `open-spec-mesh.opencode.json` overlay |
| Claude Code | `$CLAUDE_CONFIG_DIR` / `~/.claude` | `CLAUDE.md` | `skills/` | `agents/*.md` | `open-spec-mesh.mcp.json` overlay |
| DeepSeek Harness (DSH) | `$DSH_HOME` / `~/.dsh` | `AGENTS.md` | `skills/` | 不写 `agents/*.md`（DSH 不读；角色由 preset 提供） | 在 preset 内配置，安装器不写 overlay |

## 功能与业务规则

| 场景 | 操作 | 结果与边界 |
| --- | --- | --- |
| Codex 默认 | `install.sh` | 保持历史兼容 |
| 显式宿主 | `--host opencode|claude` | 安装宿主原生 Rules / Skills / Agents |
| DSH 宿主 | `--host dsh` | 只写目标项目 `AGENTS.md` 受管章节与 `$DSH_HOME/skills/sdd-*`；不写 `agents/*.md`、不安装 Research 工具，`--with-laya` fail closed |
| DSH preset | `dsh plugin --profile <profile> add open-spec-mesh` | 由 DSH 把参数转发给 profile 目录内的 pnpm，从而提供 `sdd` 预设；安装器不改写 profile |
| 自定义 Home | `--host-home <path>` | 安装到显式配置根 |
| 项目资料 | `--include-project-docs` | 显式安装包参考 docs；默认不碰业务 docs |
| 用户配置 | 安装 / 升级 | 非 Codex 不解析/重写用户 provider、model、plugins 或 settings |
| 同名未受管资产 | 非 Codex 安装 | 拒绝覆盖；必须由用户先处理冲突 |
| Research MCP | 默认检测/安装；`--skip-tools` 可跳过 | package-owned overlay 只引用环境变量名 |
| dry-run | `--dry-run` | 完整预检，不写目标 |
| 升级失败 | 事务回滚 | 恢复本次已移动受管文件，不删除未受管文件 |

OpenCode / Claude 的 host manifest 只声明 Open Spec Mesh 自己拥有的路径，重复安装幂等。Rules 文件使用 managed marker 合并，用户正文保留。OpenCode 的 Markdown Agent 与 overlay `agent` map 都由同一 canonical Role 渲染：前者保持原生可读布局，后者保证当前正式版 CLI 能稳定发现角色；二者都不写入用户模型/provider。

原 `$sdd-change` 已拆分，需求技能现名为 `$sdd-req`；`sdd-change` 与旧名 `sdd-requirements` 均不再作为受管技能安装，旧 `sdd-change/scripts/` 入口已删除。升级时，已登记的旧目录先保存到 `open-spec-mesh/retired-skills/` 下的私有 ZIP，再退出技能发现；归档包含本地修改，不自动清理。未登记的用户目录保留并提示，不按名称删除。

## DeepSeek Harness (DSH)

DSH 侧由两件互不重叠的事组成：preset 由 DSH 按插件包分发，本包安装器只准备项目规则与技能。

- 挂载 preset：`dsh plugin --profile <profile> add open-spec-mesh`，参数是 registry 包名或本地仓库路径，由 DSH 转发给 profile 目录内的 pnpm；重启 profile 后预设出现为 `sdd`。卸载是 `dsh plugin --profile <profile> remove open-spec-mesh`。以上为命令语义，本仓库未记录真实挂载实测。
- 版本要求：preset 引用 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 子路径，该子路径自 DSH 0.2.1-rc.4 起提供，因此包元数据声明 `engines.dsh >= 0.2.1-rc.4`。DSH 读取顶层 `engines.dsh`，低于该范围时拒绝安装或激活插件；这是要求，不是“已验证挂载成功”。
- `open-spec-mesh install --host dsh`（等价 `osm install --host dsh`）只做两件事：写/合并目标项目 `AGENTS.md` 的受管章节，把 `sdd-*` 技能装到 `$DSH_HOME/skills`。它不写 `agents/*.md`（DSH 不读）、不安装 Research 工具，`--with-laya` 直接报错退出——DSH 的 MCP 在 preset 内配置。
- 升级：先升级命令（`npm install -g open-spec-mesh@<version>`），再重跑显式安装以更新 `AGENTS.md` 受管章节与 `$DSH_HOME/skills`；preset 随插件包版本变化，需要用 `dsh plugin --profile <profile> add open-spec-mesh@<version>` 重新挂载（pnpm 语义，未做真实挂载实测）。
- 卸载：`dsh plugin --profile <profile> remove open-spec-mesh` 移除 preset；`npm uninstall -g open-spec-mesh` 只删全局命令，不删除 `AGENTS.md` 受管章节或 `$DSH_HOME/skills`。

角色路由：preset 的 `osm:role-routes` section 把 `~/.dsh/osm-models.json`（`$DSH_HOME` 可覆盖基目录）渲染成「角色 → provider/model/reasoning_effort」表，派发时用原生 `subagent` 工具显式传这三项；`osm models list|doctor|check|set|reset` 管理与诊断该配置。其中 `osm models doctor`（别名 `osm models check`）校验配置语法、4 个核心角色完整性与合法思考档位，以轻量字符表格直观呈现并输出一键修复建议。osm 不校验 allowlist，越界路由由 DSH 拒绝。

## 模型与 Provider

Codex 延续现有 Role TOML model / effort。OpenCode / Claude 生成的 Agent 不写 Codex 模型名，默认继承宿主/用户当前模型。安装器不会读取、复制或迁移模型凭据。

## 可选 System One

本次多宿主适配覆盖 Quick / SDD 指导、文档辅助和 Research MCP。托管 Laya/System One bridge 仍只在 Codex host 支持；OpenCode / Claude 请求 `--with-laya` 必须 fail closed，而不是生成不完整配置。

操作见 [本地工具包](../../04-operations/O02-applications/O02-01-local-toolkit.md)。

## Node 22 与全局 npm 分发

最低 Node.js 22.0.0；当前公共发布版本为 open-spec-mesh@0.2.0。npm install -g open-spec-mesh@0.2.0 --registry=https://registry.npmjs.org/ 提供命令；本地源码和 tarball 仍可全局安装。npm 无宿主配置安装钩子，仍需显式 open-spec-mesh install --host codex|opencode|claude|dsh --skip-tools。升级是“更新命令 + 显式更新宿主”两步，卸载命令不自动删 Home。registry 认证/上传/消费验证与文档准备分开记录，不能把尚未完成的发布写作成功。

Skill 自带仅作用于受管目录的 ESM 模块声明；独立 MCP wrapper 在 Node 22 可启动，不修改用户 Home/MCP 整体模块类型。升级真正应用旧资产退役操作，替换受管 Skill，清理已识别 Python bridge 和缓存，保全用户未受管脚本。
