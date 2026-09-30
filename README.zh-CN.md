# Open Spec Mesh

Node.js 工具集与 **Quick / 人工推动的 SDD 研发规范**。旧自动 SDD 生命周期已退出。

[English](README.md)

## 前置条件

- **Node.js 22.0.0 及以上**、兼容的 npm、Git。
- Linux/macOS 宿主配置路径；最低版本使用 Node 22.0.0 + npm 10 验证，不要求安装最新版 npm。
- 已安装 Codex、OpenCode 或 Claude Code。本包不安装这些宿主，不提供模型账号或密钥。

## 从 npm 公共仓库安装

公共 npm **0.0.1 已发布**；以下命令按该版本安装。若使用镜像遇到 E404，请核对 registry，不要把本地打包成功当成发布成功。

```sh
# 第一步：安装全局命令，不会自动改动宿主配置。
npm install -g open-spec-mesh@0.0.1 --registry=https://registry.npmjs.org/
open-spec-mesh --version

# 第二步：预览并显式配置 Codex。
open-spec-mesh install --host codex --skip-tools --dry-run
open-spec-mesh install --host codex --skip-tools
```

预期命令版本为 `0.0.1`。安装后新开宿主会话，让其读取最新 Rules、Role 和 Skill。

`--skip-tools` 只安装核心工具包，不额外安装 Research 工具，不宣称 Research MCP 可用，也不启用 System One。npm 安装没有擅改 Home 的 postinstall；**全局命令安装与宿主配置安装是两步**。

### 选择宿主与配置目录

```sh
# 默认分别使用 ~/.codex、~/.config/opencode、~/.claude。
open-spec-mesh install --host codex --skip-tools
open-spec-mesh install --host opencode --skip-tools
open-spec-mesh install --host claude --skip-tools

# 自定义配置根；有空格的路径必须加引号。
open-spec-mesh install --host codex --host-home "/path/to/codex home" --skip-tools
```

默认目录同时支持 `CODEX_HOME`、`OPENCODE_CONFIG_DIR`、`CLAUDE_CONFIG_DIR`。Codex 兼容参数 `--codex-home` 保留。具体宿主启动方法见 [运行指南](docs/04-operations/O02-applications/O02-01-local-toolkit.md)。

### 不安装全局命令，直接运行

```sh
npm exec --yes --registry=https://registry.npmjs.org/ --package=open-spec-mesh@0.0.1 -- \
  open-spec-mesh install --host codex --skip-tools
```

### 源码或本地打包安装

```sh
# 在仓库目录执行；全局命令链接源码目录，不要移除该目录。
npm ci
npm install -g .
open-spec-mesh install --host codex --skip-tools

# 或生成便携 tarball；依赖安装仍需 npm 网络或缓存。
npm pack
npm install -g ./open-spec-mesh-0.0.1.tgz
open-spec-mesh install --host codex --skip-tools
```

### 升级、卸载和常见问题

```sh
# 更新全局命令后，仍需显式升级宿主受管内容。
npm install -g open-spec-mesh@latest --registry=https://registry.npmjs.org/
open-spec-mesh install --host codex --skip-tools --dry-run
open-spec-mesh install --host codex --skip-tools

# 仅卸载全局命令；不会删除已配置的宿主资产。
npm uninstall -g open-spec-mesh
```

- 升级前备份受影响的受管路径与配置。安装失败会事务回滚，但成功后不会自动长期保留备份。
- 升级整体替换受管 Skill，清除旧 Python 脚本和缓存，应用已知旧 Skill/角色退役；已识别受管 Python MCP 改为 Node 并定向清理 helper/cache。
- 保全用户模型/provider、凭据、自定义 MCP、无关 Python 和未受管资产；同名未受管资产冲突时拒绝覆盖，不应删除整个 `~/.codex`。
- 命令找不到时检查 npm 全局 bin 的 `PATH`，Linux/macOS 通常为 `$(npm prefix -g)/bin`。权限问题优先使用用户自有的 Node/global prefix，不自动用 sudo 改写宿主配置。
- 发布者操作见 [npm 发布指南](docs/04-operations/O02-applications/O02-02-npm-publication.md)；登录、打包、dry-run、真实上传是不同状态。

## osm 短命令（本地源码已实现，尚未发布）

当前 npm 0.0.1 仍使用 open-spec-mesh。osm 已在本地源码提供；需在源码目录 npm ci 后 npm install -g . 才可使用（这不是 registry 升级）。

```sh
osm --dry-run  # 默认 Codex 安装预览，不写 Home
osm            # 等价于 open-spec-mesh install --host codex --skip-tools
osm --help
osm --version
osm install --host opencode --skip-tools
```

不带参数的 osm 是用户显式触发的安装，不是 npm postinstall；原 open-spec-mesh 无参数仍显示帮助，完整命令兼容。真实 npm 发布需要明确的发布意图和目标版本；“发布 0.0.2”等自然语言指令会自动使用 `$sdd-release`，无需改写为技能口令。仅准备材料时不上传。

## 当前工作流程

- **Quick**：当前 Agent 连续调查、实现、测试、自审；陌生本地事实优先 Explorer，外部文档/版本优先 Librarian，减少主线程重复遍历。
- **SDD**：需求 → 整体设计 → 执行计划（任务拆分与任务设计）→ 实现 → 交付，每阶段人工确认；用户可明确一次授权多个阶段。
- 单任务或串行由当前 Agent 在当前工作区执行；只有用户确认并行时才使用 Worker 和独立 worktree。
- 设计不冻结文件、函数或编码步骤；执行者可处理必要局部调整，实质目标、验收、安全或重要公共方案变化才请用户确认。
- 新代理使用 `role_desc`，如 `explorer_module_flow`；配置角色 ID 保持不变。
- 文档/检查辅助人工评审，不自动推进阶段；真实测试和安全检查仍必须处理。

## SDD 技能使用引导

选择 SDD 模式后，Main 会说明当前阶段、给出可直接使用的技能调用示例，并在阶段完成时提示下一步；不会因为技能执行成功自动推进。

| 阶段或需要 | 技能 | 示例 |
|---|---|---|
| 按需初始化文档骨架 | `$sdd-init` | `$sdd-init 为当前项目建立文档骨架` |
| 需求 | `$sdd-req` | `$sdd-req 为这个需求创建或完善 Change` |
| 整体设计 | `$sdd-design` | `$sdd-design 需求已确认，编写整体设计` |
| 执行计划：任务拆分与任务设计 | `$sdd-plan` | `$sdd-plan 整体设计已确认，编写执行计划，包含任务拆分和任务设计` |
| 实现与验证 | `$sdd-do` | `$sdd-do 执行计划已确认，按计划串行实现并验证` |
| 交付与确认后归档 | `$sdd-close` | `$sdd-close 汇总实现结果和验证，先供我确认` |

已有文档骨架无需重复初始化。旧结构迁移用 `$sdd-migrate`；持久化研究/长期 ADR 按需用 `$sdd-research`；执行诊断仅在用户要求时用 `$sdd-diagnose`；版本发布材料用 `$sdd-release`，真实上传需要明确发布意图及本次目标版本，自然语言同样有效。自然语言授权也有效，调用技能不等于确认所有后续阶段。若技能未安装或当前会话不可用，Main 应如实说明并引导安装或加载。

原 `$sdd-change` 已拆分，需求技能现名为 `$sdd-req`；`sdd-change` 与旧名 `sdd-requirements` 均不再作为受管技能安装，旧 `sdd-change/scripts/` 入口已删除。升级时，已登记的旧目录先保存到 `open-spec-mesh/retired-skills/` 下的私有 ZIP，再退出技能发现；归档包含本地修改，不自动清理。未登记的用户目录保留并提示，不按名称删除。

## 日常命令

```sh
open-spec-mesh --help
open-spec-mesh init-project --root /path/to/project
open-spec-mesh new-change feature --root /path/to/project
# 人工确认后再进入相应阶段：
open-spec-mesh ensure-design CHG-YYYYMMDD-feature --root /path/to/project
open-spec-mesh new-task CHG-YYYYMMDD-feature capability --root /path/to/project
open-spec-mesh validate-docs --root /path/to/project
```

new-change 只写需求；new-task 写宏观 Markdown 与人可读计划，不生成机器执行状态。observe/diagnose 只收集证据。发布辅助命令只写材料，不代替真实 npm 上传或部署。

## 可选服务与开发验证

Research 工具另需 `CONTEXT7_API_KEY` / `TAVILY_API_KEY`；在调用环境中导出自己的值，再去掉 `--skip-tools` 安装。npm 包不包含用户凭据，npm 安装不写入密钥。

System One 默认关闭；自托管 GPU 服务、专属 Python CI 与依赖已退出。仅保留 Node.js HTTP/MCP 客户端连接外部兼容推理服务，不下载模型、不启动本地推理、不调用 Python。受管 bridge 当前只支持 Codex。

在源码目录执行：

```sh
npm ci
npm run validate:core
npm run validate:full
```

full 另需真实宿主 CLI、Docker、Mermaid 与 Research 工具。缺失前置条件如实失败，core 全绿不等于外部宿主或推理服务已经全绿。第一方工具、测试和自动化均为 Node.js，Python 源文件审计坚持零例外。

更多说明见 [工作约定](AGENTS.md)、[工具指南](sdd-init/references/runtime-guide.md)、[文档规范](sdd-init/references/document-contract.md) 和 [项目文档](docs/index.md)。
