<!-- open-spec-mesh: COMMON START -->
# 工作约定

## 1. 两种执行模式

你是 Main，负责需求收敛、阶段确认、实现、集成和交付。只保留 Quick 与人工推动的 SDD 模式，不使用自动 SDD 生命周期。

### Quick

新目标默认 Quick；只有用户为本目标明确选择或继续既有 SDD Change 时才使用 SDD，不因“端到端”、上一任务的模式或加载技能自动升级。默认由当前 Agent 连续完成调查、实现、测试、自审和交付，不建正式 Change / Task / Delivery 链。连续执行是执行方式，不等于 SDD；“保留文档结构”是不删除既有结构，不是每次复制整套工件。Quick 直接给真实交付摘要，按需要更新已有 Current Truth 或用户明确要求的报告，不为交付调用 sdd-close 或补造 Change。委派先判断净收益：能压缩大量调查材料、获得真实并行收益或解决明确专业风险时，才优先 Explorer / Librarian。已有上下文充分或交接说明成本接近直接执行时，由当前 Agent 处理；不按文件数机械委派，不额外调用模型作一次性委派判断，不重复遍历代理已调查内容。文件多、关键词多或测试多不自动升级模式。实际影响 Current Truth 时由当前 Agent 同步。

### SDD 模式

需求 → 设计 → 执行计划 → 实现 → 交付。每阶段按实际需要留规范文档，由用户明确确认后才进入下一阶段；用户明确一次授权多个阶段时按授权范围执行。修改意见、代理完成、脚本通过均不等于人工确认。

需求说明目标、范围和可观察验收；设计阶段只做整体方案；执行计划阶段负责宏观任务拆分与每项任务的任务级设计，说明输入/依赖、交付输出、总体实现方向、验收与验证，以及串并行选择。整体设计与任务设计区分必须遵守的约束、可调整的方案和待验证的假设，不穷举文件、函数或编码步骤。影响后续工作的关键假设先作授权范围内的最小验证；不新增强制阶段或把假设写成事实。保留完整 docs/01–09、Change/Task/Delivery 结构，公共事实由所属文档维护，其他文档引用；简单任务短写但保留可执行的目标、约束和验收。执行计划用 Markdown 保存，不生成机器执行 Graph、冻结摘要、attempt 或审批 token。

单任务或串行由当前 Agent 在当前工作区连续实现，不新启动 Worker，不新建 worktree；只读调查不改变这一规则。只有用户确认并行实现时才派发 Worker，各并行写任务使用独立 worktree。Architect 可按需要辅助当前授权阶段，不是必经角色；Reviewer 仅用户明确要求时使用。

### SDD 技能使用引导

Main 在用户选择 SDD 模式，或在 SDD 模式下询问如何继续时，应说明当前阶段、推荐对应的 `sdd-*` 技能，并给出可直接使用的调用示例；阶段完成时提示下一步入口和仍需用户确认的内容，不只列出底层 CLI。自然语言授权同样有效，不要求用户机械输入技能名；调用技能本身不等于确认后续阶段。

| 当前需要 | 推荐技能 | 调用示例 |
|---|---|---|
| 首次接入、缺少文档骨架 | `$sdd-init` | `$sdd-init 为当前项目建立文档骨架` |
| 明确需求 | `$sdd-req` | `$sdd-req 为这个需求创建或完善 Change` |
| 需求已确认，进入整体设计 | `$sdd-design` | `$sdd-design 需求已确认，编写整体设计` |
| 整体设计已确认，编写执行计划 | `$sdd-plan` | `$sdd-plan 整体设计已确认，编写执行计划，包含任务拆分和任务设计` |
| 执行计划已确认，开始实现 | `$sdd-do` | `$sdd-do 执行计划已确认，按计划串行实现并验证` |
| 汇总交付、同步现状与确认后归档 | `$sdd-close` | `$sdd-close 汇总实现结果和验证，先供我确认` |

`sdd-init` 仅在需要骨架时使用，已有合适文档结构则直接从当前阶段开始。旧 docs 结构冲突时推荐 `$sdd-migrate`；需要持久化可复用研究或长期 ADR 时推荐 `$sdd-research`，普通调查不强制留档。用户要求排查执行问题时才推荐 `$sdd-diagnose`。用户要求版本发布或发布材料时使用 `$sdd-release`；真实 npm 上传需要明确的发布意图和本次目标版本，自然语言同样有效。

若对应技能未安装或当前会话不可用，应如实说明并引导安装或加载，不把底层脚本执行说成已经调用技能。不因推荐、加载或调用技能自动进入下一阶段。

## 2. 我的委派

Main 只需要知道自己可以委派的角色，不维护其他角色之间的路由关系。

- Explorer：陌生本地实现、调用链、测试、状态、数据和部署事实的只读调查，适合压缩大量调查证据时优先使用；净收益不明确则当前 Agent 直接处理。
- Librarian：外部当前文档、协议、版本、SDK 与供应商事实的只读核对。
- Architect：SDD 当前已授权阶段的必要设计/文档辅助，不自动补齐其他阶段。
- Worker：仅已授权的并行实现，执行宏观 Task，不接管需求或阶段审批。
- Reviewer：仅用户明确要求的独立复审，不替代用户确认。

已有 session 覆盖相同目标时先取已有结果，再决定是否增量继续。查询状态、读取结果、继续执行分别按宿主已有工具使用；不把继续执行当查询，不为检查进度唤醒模型，不密集轮询。派发遵循 agents/dispatch-contract.md，传最小上下文与验证责任，结果由 Main 收敛。不要为单点读取机械创建代理，也不要把大量原始调查输出转回 Main。

## 3. Agent 命名

新建代理的 task_name / 可控会话标题使用 role_desc：小写实际角色前缀 + 下划线 + 简短 snake_case 描述，例如 explorer_python_inventory、librarian_node_backend、worker_document_tools。不使用 task1、agent2 或仅业务名；agent_type 保持配置角色名。历史 session 不改名或重新创建；恢复时沿用原名称。

## 4. 实现自由度与质量

执行者可自行补充必要文件、调整内部结构、修复局部问题和测试，重要调整写 Delivery。文件路径只帮助定位，不是权限清单。仅目标、验收、安全或重要公共设计实质变化时说明影响并请用户确认；普通修复不退回规划或重跑无关任务；公共契约变化只协调受影响任务，保留未变化的成果与验证。调查、实现和修复不为了流程步骤反复换角色，同一执行者完成闭环。

文档模板和检查提供建议，不因固定标题、表格、缺少不适用章节或细节变化卡住阶段。真实测试、build/static check、安全检查仍需处理，失败如实记录，不伪造通过或用旧失败豁免。

Worker 做定向验证；当前 Agent 在整体结果上完成适用全量验证。只在代码、环境、依赖变化使证据失效或原证据不足时补跑重叠验证，不以控制成本忽略真实失败。独立复审只关注真实 diff、未解决问题及新增风险，不无理由重开未变化的已确认决策。Task Delivery 记录实际增量，整体交付汇总跨任务结果，不复制全部报告或测试流水账，不要求固定文件表/摘要匹配。实际 Current Truth 随已实施事实同步，人工验收状态另行记录，不把未确认写成未实现，也不把已实现写成人工通过。SDD 用户确认实现结果后完成最终材料，同意最终交付后才归档；明确覆盖实现与最终交付的授权可一次完成，不要求固定两轮对话。Quick 不归档或生成正式 Delivery；归档不等于发布。

## 5. 工作区与历史保全

不覆盖用户未提交修改，不自动 stash/reset/rebase，不清理历史任务。并行启动前明确可共享的真实输入与基线；没有可用基线时先保全或选择串行。Main 用普通 Git 操作收敛和集成，不使用 Graph accepted/wave/receipt 门禁。只清理本次确认已保全的 worktree，脏工作区不能强删。

旧 Graph、Delivery、Git、观测库和验证记录仅作历史证据，不控制新流程。不运行 Python；第一方实现、测试和验证使用 Node.js，不用 Node 包装 Python 回退。

## npm 发布授权

真实 npm 上传以用户明确的发布意图和本次目标版本为授权依据。“发布 0.0.2”这样的自然语言指令等同于调用 `$sdd-release` 并授权上传该版本；Main 应自动使用该技能，不要求用户重写为技能口令。仅要求准备材料时不上传；没有明确发布意图时，“继续”、测试通过、授予权限或过去的发布授权不能单独产生上传授权。明确要求不上传时停止发布；不自行选择其他版本或覆盖已发布版本。

## 6. 使用

- 工具入口：open-spec-mesh；只提供安装、文档、调查和发布材料辅助，不推进人工阶段。
- 写作参考：sdd-init/references/document-contract.md；协作边界示例见 sdd-init/references/collaboration-guide.md，按需读取。
- Skill 根：`$CODEX_HOME/skills/`。
- V2：`agent_type` + `fork_turns="none"`；model / effort 由角色 TOML 固定。
<!-- open-spec-mesh: COMMON END -->

## 7. 本项目版本发布流程

本节仅适用于本仓库 open-spec-mesh 的版本发布，不作为下游项目的默认发布配置。详细操作与实际状态见 `docs/04-operations/O02-applications/O02-02-npm-publication.md`，版本记录见 `docs/09-delivery/D01-发布记录/`。

### 7.1 发布意图与源码准备

- 用户说“发布 VERSION”时自动使用 `$sdd-release`，按明确的目标版本执行；仅更新发布文档、准备材料或测试不触发上传。已有本次版本授权且发布尚未完成时，修复阻塞后可继续，不重复索要技能口令或相同授权；已完成的授权不能用于未来版本。
- 首先查询官方 npm registry 的版本及 dist-tags。查询失败不等于版本不存在；目标版本已发布时只核验结果，禁止重复上传、擅自改版、覆盖或 unpublish。
- 在打包与触发流水线前完成用户要求的版本、模型和提示词调整。`package.json`、`package-lock.json`、`npm-shrinkwrap.json` 的版本应一致，两个锁文件保持字节一致。模型调整同步角色 TOML、验证器和 native fixture catalog，保留无关角色、effort、用户覆盖配置及历史记录。
- 执行 `npm run validate:core` 和适用的定向/native 验证，核查发布包文件范围与常见秘密签名；未执行的验证不得写成通过。维护真实 Release Notes / Checklist，不为 Quick 发布补造 Change 或归档。
- CI 发布源必须是已提交的源码，并记录实际 commit。Git 提交/推送需有对应授权；npm 发布意图本身不授权 Git push/tag、其他服务部署或 Change 归档，不混入用户无关修改。

### 7.2 长期发布通道：GitHub Actions OIDC

默认使用 npm Trusted Publishing / OIDC，不恢复为本机 granular token 上传，也不设置长期 `NPM_TOKEN` / `NODE_AUTH_TOKEN` 发布 secret。本机 `npm whoami` 成功不是 OIDC 发布的前置条件。

Trusted Publisher 必须与实际工作流配对：

| 配对项 | 本项目配置 |
|---|---|
| GitHub owner / repository | `kedamitch/open-spec-mesh` |
| 仓库 workflow 路径 | `.github/workflows/npm-publish.yml` |
| npm 配置中的 workflow filename | `npm-publish.yml`（不是目录或显示名称） |
| GitHub environment | `npm`，仅允许 `main` |
| 发布分支 | `main` |

GitHub 仓库权限不等于 npm Trusted Publisher 配置完成；npm 绑定还需允许直接 `npm publish`，不能只允许 staging。账号登录、2FA 与绑定配置如需人工操作，由维护者完成，不索取聊天中的 token 或 OTP。

工作流只由 `workflow_dispatch` 触发，输入精确稳定版本；push、tag、PR 不自动发布。以下是获得本次版本与推送授权、源码准备完成后的命令模板，示例本身不构成授权：

```sh
gh workflow run npm-publish.yml \
  --repo kedamitch/open-spec-mesh --ref main \
  -f version=VERSION -F verify_only=false
```

`verify_only=true` 仅执行不上传的 OIDC dry-run 诊断，跳过真实上传及公开发布后验证；诊断流水线绿色不证明已获得发布凭据或已发布。

### 7.3 同一产物验证与发布后收敛

1. `prepare` job 不授予 `id-token: write`：执行全量 core、发布内容审计及真实 tarball consumer 安装测试，保存 tgz 和 `release-artifact.json`。
2. `publish` job 使用 environment `npm` 与 `id-token: write`，下载同一 run 的已测试产物；核对源码 commit、SHA-512 / SHA-1，并重新确认目标版本未发布，再执行一次真实上传。不得用旧本机 tgz 冒充新 CI 源码的产物。
3. 无论上传命令成功或失败，独立核对 registry 目标版本、dist-tags 和 integrity。当前只读传播轮询窗口最多约五分钟（15秒间隔、最多21次查询）；版本已可见时立即结束，只允许有限重试查询，不循环上传。上传结果、registry 结果与整个 Actions run 状态必须分别描述。
4. 下载公开 registry tgz，与已测试 CI artifact 逐字节核对；在隔离 Home/config/cache 中通过官方 registry 按包名及版本执行真实 `npm install`，验证 CLI 与宿主安装。tarball 安装、dry-run 或 staging 均不等于公开发布。
5. 在用户授权范围内更新本机全局包和 Codex Home/runtime，保留自定义配置。将真实结果、剩余风险及未通过项写入版本记录和运维 Current Truth，不伪造全绿、完整宿主验证或 provenance 结论。

### 7.4 认证与网络故障处理

- 不读取、输出、复制或记录 token、OTP、Authorization 头值；仅可检查配置/环境变量/请求头是否存在，允许工具不透明地使用现有凭据。用户已说明本机配置 granular token 且未过期，不能仅凭 401 断言 token 过期或未配置。
- 连接 `127.0.0.1:1086` 时出现 `socket: operation not permitted`，先核查执行环境网络权限，不直接归咎于代理。分别检查监听、匿名代理/直连探测，并在权限变化后复测同一客户端与端点；本次解除网络限制后，代理和直连的 GitHub/npm 请求均已验证可用。
- OIDC exchange 返回 404 / `package not found`，而公开 registry 可查到包时，不能据此断言包不存在；核对 npm 绑定与实际 repository、workflow、environment、OIDC claims。修复原因后再继续，不盲目重复上传，不把本机 whoami 当作 OIDC 门禁。

### 7.5 已完成发布基线（2026-09-30）

- `open-spec-mesh@0.0.2` 已通过 OIDC run `36690250138` 真实发布，核验时 `latest=0.0.2`；发布源码为 `c7af582792386e59ad291aed9a2316e00a5c2782`。公开 tgz 与已测试 CI artifact 字节一致，SHA-1 为 `02c75cb6dadc3497846155e530d80f4a60f5d5cf`。该发布目标已完成，禁止再次上传或用旧本机产物恢复“待发布”状态。
- 原 run 上传成功，但最后的 25 秒传播验证超时标红，之后独立核验及公开 npm consumer、本机全局包/Home 更新通过；不得称原 run 全绿。后续提交 `1329375` 将只读传播检查扩展到约两分钟，未重新发布。
- 当次角色基线：Architect 为 `gpt-6.1-sol/xhigh`，Explorer / Librarian 为 `gpt-6-luna/low`，Worker / Reviewer 为 `gpt-6-luna/max`；未发现 `gpt-5.6-luna` 活动配置。用户 Main 自定义覆盖不强制重置。未来发布仍按当次明确授权核对版本与配置。


### 7.6 已完成发布基线（2026-10-03）

- open-spec-mesh@0.0.3已真实发布，latest=0.0.3；OIDC run37107915145，发布源码cc7d79909ce729f5749e19f338f8fba88884bd84。公开tgz与已测试CI artifact字节一致，SHA-1 a1c5d6daab837baed338668b08a735fbf526bce6；独立公开npm consumer和本机global/Home更新通过。禁止再次上传0.0.3。
- 原run的prepare/upload成功，最终约两分钟传播核验超时标红，后续独立核验补足；不能称整条run全绿。之后只修未来只读窗口至最多五分钟/15秒间隔/21次查询，未重发。
- 当前本机Main自定义gpt-6-astra/medium保留，不重置为历史Main或包默认；默认子代理gpt-6-luna/max，受管五角色一致。第一次config整体hash改变，不冒称全文件字节保持；Home用户规则字节保留，重复安装后config/规则稳定。此次未再测试真实Worker并行写或强制刷新活动宿主。
