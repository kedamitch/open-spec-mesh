# DSH 预设接线修复｜根因与设计

本文件记录 preset-sdd 从"能挂载"到"运行时成立"的根因判断与修法；目标与验收见 [C01-change.md](C01-change.md)，实际结果见 [C04-delivery.md](C04-delivery.md)。

三段边界：**A 决定运行时行为**（`dsh/` 下的预设接线与插件），**B 决定安装产物**（`lib/installation/`、`lib/cli/` 与插件对模型配置的依赖），**C 只描述已发生事实**（包元数据、README、安装文档）。按 A → B → C 推进，避免文档先于实现声明行为。

## 段 A：运行时接线（3 改 1 删）

### P0-1｜persona 的路径字符串没有被任何机制锚定

- 证据（改动前）：`dsh/cordis.patch.yml` 里 `config.prefix` 的取值是 `./prompts/sdd-persona.md`（`git diff dsh/cordis.patch.yml` 的删除行）。
- 证据（宿主）：patch 条目里只有 `name` 会被转成 file URL —— `dsh-app-boot/lib/index.js:3969-3977` 的 `anchorInsertedPluginNames` 仅对 `entry.name` 做 `pathToFileURL`。
- 证据（插件契约）：`dsh-persona/lib/types/index.d.ts:30` 声明 `prefix: string;`；`dsh-persona/lib/index.js:39` 把 `config.prefix` 直接作为 `DEPLOYMENT_PERSONA_PREFIX` section 的 `text`。
- 根因：宿主不对 config 字符串做相对路径解析，persona 拿到的是路径文本本身，47 行人格从未进入系统提示。
- 修法：`dsh/cordis.patch.yml:14` 起改为 `prefix: |` 块标量内联（正文 `:15`–`:63`），删除 `dsh/prompts/sdd-persona.md`（47 行，`git diff --stat`）。
- 为什么这么修：契约只有文本一种形态；内联让内容随 npm 包分发，不再依赖运行期文件相对位置，同时删掉唯一使用点，避免留下"以为还在生效"的死文件。
- persona 内容同步（同一文件）：5 处 `spawn_*` 改为"按角色路由表用原生 `subagent` 显式传 provider/model/reasoning_effort"；定级行固定为 `【定级】Level: <L0 | L1 | L2> | 判定依据:`；新增第 4 条红线"绕过路由表派发"（`dsh/cordis.patch.yml:63`）。改这些的原因在 P0-2：被调用的工具本来不存在。

### P0-2｜自造角色工具从未注册，且依赖不存在的宿主 API

- 证据：`dsh/gatekeeper.mjs` 曾注册 5 个 `spawn_*` 工具定义，但从未调用 `ctx.tools.register`；同时使用 `ctx.tools?.subagent?.call?.()`。
- 证据（宿主）：ToolRuntime 上没有 `subagent` 方法，公开方法集合见 `dsh-tools/lib/types/index.d.ts:610` 起的 register/restrict/guard/get/schemas/execute/presentAs。
- 根因：插件自造了一层工具，既没有注册进宿主 catalog，也没有可调用的宿主 API；persona 里的 5 处 `spawn_*` 指向不存在的工具。
- 修法：删除整套自造工具，改为 `osm:role-routes` system prompt section（`dsh/gatekeeper.mjs:19`，注册于 `:158`），内容由 `loadModelsConfigWithDiagnostics` 渲染 `~/.dsh/osm-models.json`（基目录可被 `DSH_HOME` 覆盖，`lib/installation/models-config.js:40`）；派发回到原生 `subagent`。
- 为什么这么修：原生工具的参数校验、权限与呈现都由宿主负责，插件只提供"角色 → provider/model/effort"这一份事实，不再伪造工具面。

### P1｜门控依赖了不存在的 section 与错误的上下文

- 证据：旧实现依赖 `context.agent.session` 与 `section.name === 'skills:catalog'`；全仓检索无 `skills:catalog` 这个 section 名。
- 证据：技能目录由宿主以 user 消息注入到 pre-step 决策中，标记为 `source.kind === 'skill-catalog'`。
- 修法：指令改写与技能裁剪整体挪进 `agent/pre-step`（`dsh/gatekeeper.mjs:170`，`{prepend:true}`），保留 `source`/`baseline`/`baselineIdentity` 以免切断宿主指令插件的对账；只对 `L0`/`L1` 且 `source.kind === 'skill-catalog'` 的消息（`:205`）按行裁掉技能列表中名字以 `sdd-` 开头的条目，并保留 `source.entries`。
- 为什么这么修：pre-step 才是宿主真正注入这些消息的位置；裁掉 `source.entries` 会让宿主用 entries digest 判目录过期时得出错误结论。

### P1｜等级判定扫错了对象，导致永久 fail-open

- 证据：旧实现扫 `decision.messages` 找 `role === 'assistant'`，但 pre-step 的 messages 是 inbox 的 `UserMessage[]`（role 恒为 `user`），于是永远得到 UNKNOWN → fail-open。
- 证据（宿主）：assistant 文本只存在于会话事件 `'assistant/message'`（`dsh-session/lib/types/types.d.ts:331-338`）。
- 修法：`detectLevelFromSession(session)`（`dsh/gatekeeper.mjs:113`）逆序扫 `session.surface.nodes` → `session.eventAt(seq)`，只认 `type === 'assistant/message'` 的 text 块，用 `/Level:\s*(L0|L1|L2)/` 匹配；调用点在 `:178`。
- 为什么这么修：fail-open 会把 L2 任务当 L0 处理（既跳阶段确认也跳文档），比"识别不到"更危险，所以判据必须落在真实事件上。

### P1｜压缩后状态不重置

- 证据（宿主生命周期）：`dsh-compaction-basic/lib/index.js:469` 追加 `compaction/start`，`:484` 与 `:495` 追加 `compaction/end`。
- 修法：监听 `compaction/end`（`dsh/gatekeeper.mjs:217`），同时重置 hinted、currentLevel、removedPaths。
- 为什么这么修：压缩会重写 surface，残留的定级与已裁剪路径记录会指向已不存在的事件。

## 段 B：安装器与模型配置

### B1｜模型配置两处副本，插件内那份还是旧的

- 证据：`lib/installation/models-config.js:7` 的 `DEFAULT_MODELS` 是当前值；`dsh/gatekeeper.mjs` 内曾有一份硬编码副本，其 `worker=high` 与 `fatfei-codex/deepseek-flash` 与 HEAD 不一致（HEAD 见提交 `1b9ec08`、`96ac9a1`）。
- 修法：`lib/installation/models-config.js` 成为单一事实源，新增 `loadModelsConfigWithDiagnostics(homeDir)`（`:54`）；`dsh/gatekeeper.mjs:13` 改为 `import { DEFAULT_MODELS, loadModelsConfig } from '../lib/installation/models-config.js'`（`:34` 使用），删掉插件内旧副本。
- 修法（诊断口径）：坏 JSON（`:69`）、顶层非对象（`:73`）、未知角色（`:77`）、角色非对象（`:82`）、缺字段（`:88`）逐条 push 进 problems，而不是静默回落默认值。
- 为什么这么修：两处副本必然漂移，而且旧副本会把用户显式设定的模型悄悄改掉；静默回落则让"改了但没生效"无法被发现。

### B2｜`--host dsh` 的安装语义没有收口

- 证据：dsh 不读 `agents/*.md`，技能扫描根是 `$DSH_HOME/skills`（`dsh-skill-filesystem/lib/index.js:171`，另有 `:154`/`:159` 的项目根与 `:176` 的 agents 根）；指令入口是项目 `AGENTS.md`。
- 修法：`lib/installation/installer.js:256` 对 dsh 不写 `agents/*.md`；写入/合并项目 `AGENTS.md` 受管章节；把 `sdd-*` 技能装到 `$DSH_HOME/skills`；跳过 research tools（`:439`、`:443`）与 laya 环境检查（`:351`、`:444`）；`--with-laya` 在写入前 fail closed（`:534`）；结束时给出真实产物与挂载命令（`:455`、`:510-512`）。
- 附带修掉的 bug：只删掉 dsh 分支会让 dsh 落进 opencode/claude 的 else 分支调用 `renderMcpOverlay`，在 `lib/installation/host-adapter.js:154` 对 `null` 的 commands 取 `commands[name]`，抛 `TypeError: Cannot read properties of null (reading 'codegraph')`。`:330-331` 显式把 dsh 排除在需要 MCP overlay 的宿主之外。
- 为什么这么修：写 DSH 不读的文件会让人误以为装好了，而 `--with-laya` 在 dsh 上没有对应落点，沉默忽略比直接报错更贵。

### B3｜inspect 对 dsh 给出的判定不成立

- 修法：`lib/installation/inspect.js:64-65` 对 dsh 的角色文件判定改为 `not_applicable`（不读 `agents/*.md`）；`:84` 新增顶层 `dsh: { agents_md_managed_section, sdd_skills }`；`:104-107` 的 usage 文案补 dsh 口径。
- 为什么这么修：让 inspect 报告的是 DSH 真正消费的两项产物，而不是判别一个不会被读取的文件。

### B4｜CLI 提示与校验责任

- 修法：`lib/cli/models.js:15` 打印 allowlist 归属提示（osm 不校验 provider/model 是否在名单内，校验在宿主侧）；`set` 对空值或写成下一个 flag 的值直接报错并 exit 1（`:29-33`）。
- 为什么这么修：空值静默沿用默认值会让用户以为改成功；allowlist 归属写错会让人去改一个不负责校验的文件。

## 段 C：文档与包元数据

### C1｜版本要求写在了没有读者的字段上

- 证据（宿主读取的位置）：`dsh-app-boot/lib/index.js:279-284` 的 `unmetRequirements` 读的是顶层 `engines.dsh`；`:311-314` 的 `evaluatePluginCompatibility` 据此判定兼容性。
- 证据：`dsh.engines.dsh` 在 DSH 全树无读者，那个写法来自社区插件 dsh-liangshen。
- 修法：`package.json:9` 顶层 `engines.dsh = ">=0.2.1-rc.4"`；不加 `@deepseek-ai/dsh` 的 peerDependencies（npm 7+ 会自动安装 peer，会把只装 Codex 的用户也逼着装 DSH）。
- 为什么这么修：写在无读者字段上的版本要求不会拦住任何不兼容安装。

### C2｜`exports`/`files` 与实存文件不一致

- 修法：`package.json:23` 增加 `"./package.json"`；删除死配置 `"./dsh/locale/*"` 与 `dsh/locale/en.json`、`dsh/locale/zh.json`（全仓无代码引用）；`files` 删除已无匹配的 `"dsh/**/*.json"`。
- 为什么这么修：导出不存在的路径是误导，保留无人引用的资源只会拖慢审计。

### C3｜README 与安装文档与实际状态不符

- 修法：`README.md`、`README.zh-CN.md` 版本口径 0.0.1 → 0.1.0；删除"0.0.1 仍用 open-spec-mesh、osm 只有本地源码"这类失真表述（0.1.0 已含 osm）；新增/重写 DSH 章节（`dsh plugin --profile <p> add open-spec-mesh`、预设名 `sdd`、`engines.dsh >= 0.2.1-rc.4` 及原因、`osm install --host dsh` 写什么不写什么、角色路由与 allowlist 由宿主校验）；`:180` 标题由 `Collaboration efficiency (current source, not yet published)` 改为 `(shipped since 0.0.3)`（已发布 tarball 0.0.3 与 0.1.0 均含 `sdd-init/references/collaboration-guide.md`），`:197` 的 0.0.2 断言改为当前口径。
- 修法：`docs/02-product/P02-modules/P02-03-installation.md` 的 Host 表新增 DSH 行，功能表新增 `--host dsh` 与 `dsh plugin` 两行，新增 `## DeepSeek Harness (DSH)` 小节。
- 为什么这么修：安装文档是用户唯一可执行的入口，错误的口径会直接变成错误的操作。

## 不做的事

- 不改宿主任何文件，不 fork 宿主行为。
- 不调整角色模型默认值，不把 0.1.0 之外的版本写进文档。
- 不为通过验证而放宽测试或删掉既有失败用例（安装器测试的环境性失败如实记录，见 C04）。
