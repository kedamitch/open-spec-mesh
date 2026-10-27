# DSH 预设接线修复

## 背景与目标

`dsh/cordis.patch.yml:3` 的 `preset-sdd`（显示名 `sdd`，`dsh/cordis.patch.yml:7`）此前能挂进 DSH profile，但运行时并不成立：人格从未加载、角色派发工具不存在、等级门控与技能裁剪的判断对象不存在、压缩后状态不重置。本次按宿主的真实契约把接线修好，并同步安装器、包元数据与文档。

判定标准不是"挂载成功"，而是每一条插件配置的取值方式都能被宿主真实消费：

1. persona 用宿主接受的文本形态，不依赖运行期文件位置。
2. 角色派发使用宿主原生 `subagent`，路由事实由 system prompt section 提供。
3. 等级判定读取真实会话事件；技能裁剪只作用于宿主实际注入的技能目录消息，并保留宿主对账字段。
4. 模型配置单一事实源，坏输入有可见诊断而不是静默回落。
5. `--host dsh` 只声明 DSH 真正消费的安装产物；包元数据里的版本要求用宿主真正读取的字段。

## 范围与约束

- 段 A｜运行时接线：`dsh/cordis.patch.yml`、`dsh/gatekeeper.mjs`，删除 `dsh/prompts/sdd-persona.md`。
- 段 B｜安装器与模型配置：`lib/installation/models-config.js`、`lib/installation/installer.js`、`lib/installation/inspect.js`、`lib/cli/models.js`，以及 `dsh/gatekeeper.mjs` 改为引用前者。
- 段 C｜文档与包元数据：`package.json`、`dsh/locale/`、`README.md`、`README.zh-CN.md`、`docs/02-product/P02-modules/P02-03-installation.md`。
- 宿主实现（`/usr/local/lib/node_modules/@deepseek-ai/dsh/`）只作只读依据，不修改。
- 不调整角色模型默认值：HEAD 的 `architect=fatfei-codex/gpt-6.1-sol/xhigh`、`worker`/`reviewer=opencode-go/deepseek-v4.1-flash/max`、`explorer`/`librarian=…/low` 由提交 `1b9ec08`、`96ac9a1` 有意设定，本次只消除插件内的旧副本；模型 id 于 2026-10-27 由 `deepseek-flash` 更名，provider 与 effort 未变（见「当前实施状态」）。
- 不引入 `@deepseek-ai/dsh` 的 peerDependencies：npm 7+ 会自动安装 peer，会把只装 Codex 的用户也逼着装 DSH。
- 本次不 commit、不 push、不发布；npm 上的 `latest` 仍是 0.1.0，因此本 Change 放在 `C01-进行中`。

## 可观察验收

1. AC1：`dsh --profile web --patch ./dsh/cordis.patch.yml --dump-config` 退出码 0，组合结果中 persona 段落是散文正文而不是文件路径，且 `dsh/prompts/sdd-persona.md` 已删除（见 `git status --porcelain` 的 ` D dsh/prompts/sdd-persona.md`）。
2. AC2：`dsh/gatekeeper.mjs` 不再注册任何自造 `spawn_*` 工具，改为注册 `osm:role-routes` section（`dsh/gatekeeper.mjs:19`、`:158`），渲染数据来自 `lib/installation/models-config.js`（`dsh/gatekeeper.mjs:13`、`:34`）。
3. AC3：技能裁剪只发生在 `agent/pre-step`（`dsh/gatekeeper.mjs:170`），且只对 `source.kind === 'skill-catalog'` 的消息生效（`:205`）；`source`/`baseline`/`baselineIdentity` 与 `source.entries` 保留。
4. AC4：等级判定改为 `detectLevelFromSession`（`dsh/gatekeeper.mjs:113`），在 pre-step 内调用（`:178`），只认 `assistant/message` 事件的文本。
5. AC5：`compaction/end` 同时重置 hinted / currentLevel / removedPaths（`dsh/gatekeeper.mjs:217`）。
6. AC6：`loadModelsConfigWithDiagnostics` 对坏 JSON、未知角色、缺字段逐条记录 problem（`lib/installation/models-config.js:54`、`:77`、`:88`），`tests/node/dsh/models-config.test.js` 通过。
7. AC7：`--host dsh` 不写 `agents/*.md`（`lib/installation/installer.js:256`）、不写 MCP overlay（`:330-331`），`--with-laya` 在写入前 fail closed（`:534`）；`inspect` 对 dsh 的角色文件判定为 `not_applicable`（`lib/installation/inspect.js:64-65`）。
8. AC8：`package.json:9` 声明宿主真实读取的 `engines.dsh`，`:23` 导出 `./package.json`，不再包含 `dsh/locale/*` 与 `dsh/**/*.json`。
9. AC9：`node --test tests/node/dsh/*.test.js` 通过（20 项），`node scripts/check_runtime.js` 通过。真实会话中的运行时效果不在本次验收内，见 [C04-delivery.md](C04-delivery.md) 的未验证清单。

## 用户授权

- 2026-10-27：用户要求"分析 open-spec-mesh 的 DSH 集成、对照梁神模式找出优化点和问题"，并明确先出报告、不改代码。
- 2026-10-27：报告提交后，用户同意按报告内容修复，并授权进行真实挂载冒烟与补充本次 Change 文档。
- 本次授权覆盖"修复 + 冒烟 + 文档"，最初不含 commit；后续用户明确授权本地提交（不发布、不推送），因此已按 `d712192` / `42e0ecc` / `715078e` / `e7c06f7` 与本次 `fix(install)` 提交，Change 仍留在 `C01-进行中`（未发版即未归档）。

## 当前实施状态

三段修复已落地，定向测试与静态审计结果见 [C04-delivery.md](C04-delivery.md)。安装器整目录测试（65/65）与 `--host dsh` 真实安装已跑通；`npm run validate:core` 仍未通过，但 47 条失败在干净 HEAD 上同样失败，属另一条特性线，未在本次修；真实会话中的运行时效果仍未观察。逐条列在 C04 的未验证清单，不写成通过。

- 2026-10-27 更名（不改路由语义）：预设显示名 `sdd模式` → `sdd`，与 `id: sdd` 一致、picker 显示更短（`dsh/cordis.patch.yml:7`；persona 首行标题同步为 `# sdd (Open Spec Mesh SDD & Quick)`）；角色模型 id `opencode-go/deepseek-flash` → `opencode-go/deepseek-v4.1-flash`，provider 与 reasoningEffort 不变。
- 2026-10-27 顺带修复：本次验收中发现 macOS 默认 `TMPDIR` 下真实安装被锁发布阻断（`/var` 符号链接 + `atomicWrite` 父链检查），已在 `lib/runtime/locks.js` 修好并复验 exit=0，详见 [C04-delivery.md](C04-delivery.md) 的「顺带修复」；尚未发布。
- 2026-10-27 父链守卫规范化：`atomicWrite`/`safePath` 不再拒绝祖先里的符号链接，而是把祖先 `realpath` 后再写（直接父目录与目标本身的防护不变），同批修好 `tests/node/installation` 的 16 条失败与 `migrations.js` 的 catalog 路径比较，详见 [C04-delivery.md](C04-delivery.md) 的「父链守卫规范化与锁目录残留清理」。
- 2026-10-27 孤儿锁恢复通道：`recover-lock --force --writers-stopped` 可显式清理没有 `owner.json` 的残留锁目录（有 owner 时仍必须给 token，`--force` 不能替代；未传 `--writers-stopped` 一律拒绝），已实现并通过 `tests/node/runtime/paths-locks.test.js`（13/13）与 CLI 端到端复验，详见 [C04-delivery.md](C04-delivery.md) 的「孤儿锁恢复通道」；尚未发布。
