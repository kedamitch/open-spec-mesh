# DSH 预设接线修复｜交付汇总（已本地提交、未发版）

## 交付了什么

| 段 | 实际结果 | 证据 |
|---|---|---|
| A｜运行时接线 | persona 由路径改为 `|` 块标量内联并删除死文件；自造 `spawn_*` 工具整套删除，改为 `osm:role-routes` section + 原生 `subagent`；门控迁入 `agent/pre-step`；定级改读 `assistant/message`；`compaction/end` 重置三项状态 | [C03-01 Delivery](C03-tasks/C03-01-runtime-wiring/C03-01-02-delivery.md) |
| B｜安装器与模型配置 | 模型配置单一事实源 + 诊断；`--host dsh` 只写 `AGENTS.md` 受管章节与 `$DSH_HOME/skills`，`--with-laya` fail closed；顺带修掉 `renderMcpOverlay` 的 null 解引用；inspect 与 CLI 口径校正 | [C03-02 Delivery](C03-tasks/C03-02-installation-and-models/C03-02-02-delivery.md) |
| C｜文档与包元数据 | `engines.dsh` 写在宿主真正读取的字段；`exports`/`files` 对齐实存文件；README 与安装文档校正到 0.1.0 口径并重写 DSH 章节 | [C03-03 Delivery](C03-tasks/C03-03-docs-and-package-metadata/C03-03-02-delivery.md) |

改动规模：`git diff --stat` → 13 files changed, 408 insertions(+), 261 deletions(-)；另有未跟踪的 `tests/node/dsh/`（现已随 `d712192` 提交）。

提交序列（本地，未推送、未发布）：`d712192` 预设与门控 → `42e0ecc` 孤儿锁 `--force` 通道 → `715078e` `--force` 清理锁目录内残留 → `e7c06f7` 父链符号链接规范化 → 本次 `fix(install)` 提交（迁移 catalog 规范化 + 三处夹具规范化，见「父链守卫规范化」小节）。

## 验证证据

| 验证 | 命令 | 结果 |
|---|---|---|
| 定向单测 | `node --test tests/node/dsh/*.test.js` | tests 20 / pass 20 / fail 0（`gatekeeper.test.js`、`install-dsh.test.js`、`models-config.test.js`） |
| 静态审计 | `node scripts/check_runtime.js` | `Runtime audit passed: syntax=143, Python-sources=0, package-files=367, lock=3, static-files=92`（删除两个 locale 文件前为 369） |
| 组合层面 | `dsh --profile web --patch ./dsh/cordis.patch.yml --dump-config` | exit 0；含 `name: sdd`（:1495）、persona 内联散文（:1503）、`- id: sdd-gatekeeper / name: ./gatekeeper.mjs`（:1677-1678） |
| 挂载层面（本轮已做，零残留） | `dsh plugin --profile web add <repo>` → `--dump-config` → `remove` → `diff` | pnpm 19.3s；profile `package.json` 出现 `"open-spec-mesh": "link:/Users/zhangyefei/code/tools/open-spec-mesh"`；`--dump-config` exit 0，`name: sdd`（:1432）、`id: preset-sdd` 计数 1、persona 内联计数 1、`sdd-gatekeeper`（:1614-1615）；`remove` 后与备份 `package.json` `diff` **IDENTICAL** |

## 未验证（如实列出）

1. **安装器全流程**：依赖已用 `npm ci --no-audit --no-fund` 装齐（added 109 packages）。此前 `tests/node/installation/*.test.js` 的 16 条失败经定位不是缺依赖，而是 `atomicWrite`/`safePath` 的父链符号链接守卫在 macOS `/var` → `/private/var` 上误杀本机 `/tmp`（守卫语义已改，见下一节）；现在整目录 **tests 65 / pass 65 / fail 0**。`--host dsh` 的真实安装也已在 `$HOME/.osm-selftest` 上跑通（exit=0，落 `AGENTS.md` 受管章节与 12 个 `sdd-*` 技能目录）。
2. **`npm run validate:core` 已全绿，但只覆盖 Linux 形状的路径**：全量 `node --test "tests/node/**/*.test.js"` → **tests 269 / pass 269 / fail 0**（修复前为 pass 222 / fail 47，干净 HEAD 为 218 / 51）。见下方「测试夹具规范化：47 条既有失败归零」。
3. **运行时 hook 未在真实会话中观察**：section 注入、pre-step 裁剪、`compaction/end` 重置只在 fake ctx 单测与 `--dump-config` 组合层面验证；真实挂载冒烟只到"预设注册 + 组合通过"，没有新开会话跑一轮。
4. **未 commit、未发版**：npm 上 `latest` 仍是 0.1.0（0.0.1/0.0.2/0.0.3/0.1.0 已发布）。

## 残余风险

- `dsh plugin add` 的成功只证明预设与插件被宿主接受并进入组合，不证明有人格注入、派发与裁剪在会话中按预期发生；若要在真实会话里确认，需要新开一个 profile 会话并按 AC3–AC5 逐项观察。
- 安装器的 dsh 分支只在单测与代码路径层面被覆盖，`AGENTS.md` 受管章节合并与 `$DSH_HOME/skills` 落盘未在真实 Home 上跑过完整流程。
- `engines.dsh >= 0.2.1-rc.4` 会把更旧的 DSH 判为不满足；该下限来自 `dsh-app-boot` 的兼容性字段语义，尚未用旧版本实测拒绝行为。

## 下一步

1. 在真实 profile 会话中按 AC3–AC5 观察一次运行时行为（技能裁剪是否只影响 L0/L1、定级是否读到 L1/L2、压缩后是否重新定级）。
2. 守卫是否应放过系统级祖先符号链接，是独立的产品设计议题（见 C04「已识别但未纳入的设计议题」），修复方式需先定义「可信基座」，不宜夹在测试修复里。
3. commit 与发版由人决定：本次未提交、未推送、未发布；发版前需要按仓库发布流程核对版本、锁文件与发布内容。

## 顺带修复（本次验收中发现的阻断，已修并复验，未发布）

真实安装链路在 macOS 默认 `TMPDIR` 下被阻断，本次一并修复并复验。

- 缺陷：`HOME=<home> node bin/osm.js install --host dsh --host-home <home>/.dsh` 在 macOS 上失败，报 `install failed: Lock owner could not be published; manual recovery is required: /var/folders/.../T/open-spec-mesh-locks-501/install/<sha256>.lock`。
- 根因：`lib/runtime/locks.js:12` 用 `os.tmpdir()` 直拼锁根目录，macOS 得到 `/var/folders/...`；`/var` 是指向 `/private/var` 的符号链接，而 `lib/runtime/io.js:39-49` 的 `atomicWrite` 从目标父目录一路上溯 `lstat` 到 `/`，任一父目录是符号链接就抛 `Refusing unsafe parent directory: /var`，于是锁的 `owner.json` 永远发不出去。把 `TMPDIR` 指到真实目录时同一命令 exit=0（父代理此前实测）。该守卫后来整体改为"规范化祖先"而不是"拒绝祖先"，见「父链守卫规范化」小节。
- 修法：`lib/runtime/locks.js` 把锁根目录规范化为 `realpathSync(os.tmpdir())`（`realpathSync` 抛错时回退原值），只规范锁自己的根目录；`atomicWrite` 对**用户目标路径**的符号链接防护、`withLock` 语义、以及基于 canonical target 的锁哈希都没有改动。
- 回归测试：并入 `tests/node/runtime/paths-locks.test.js`（已有同类锁测试，不另建重复文件）。新增「symlinked TMPDIR」回归用例与「锁不可重入、释放后可再次获取」用例；原有三处按 `tmpdir()` 拼锁目录的断言改为按 `realpathSync(tmpdir())` 计算，`tempRoot()` 同步改用真实路径——`atomic bytes replace...` 用例此前在 macOS 上因同一 `/var` 符号链接失败，属既有环境性失败，不是本次引入。
- 复验：`node --test tests/node/runtime/paths-locks.test.js` → tests 9 / pass 9 / fail 0；把 `lockBase` 临时改回 `path.join(os.tmpdir(), ...)` 后新回归用例失败并复现同一条 `Refusing unsafe parent directory` 报错，改回后恢复通过。`node --test tests/node/dsh/*.test.js tests/node/installation/host-adapter.test.js` → tests 26 / pass 26 / fail 0。
- 端到端：在 `$HOME/.osm-selftest`（不用 `/tmp`，它是符号链接）下建 `home/.dsh` 与 `proj`，**不覆盖 `TMPDIR`** 跑 `install --host dsh`，exit=0，输出 `installed: /Users/zhangyefei/.osm-selftest/home/.dsh`，`<home>/.dsh/skills` 出现 `sdd-*`（`sdd-close`、`sdd-design`、`sdd-do`、`sdd-init`、`sdd-migrate` 等）；跑完 `rm -rf` 该目录并确认已删除。
- 残余风险：发布失败时故意保留的锁目录（无 `owner.json`）不会自动清理——后续已补 `recover-lock --force` 通道与锁目录内残留清理（见下方两节）。同类符号链接风险：任何把 `os.tmpdir()` 结果直接交给 `atomicWrite` 的路径都会在 macOS 上踩同一个坑，根因已在下一节整体修掉。

## 孤儿锁恢复通道（追加，已实现并通过测试，未发布）

- 触发条件：进程在 `mkdirSync(<dir>.lock)` 成功之后、`owner.json` 原子改名之前退出（或其它人为干预），会留下一个**没有** `owner.json` 的空 `.lock` 目录。此后同目标的安装一律失败于 `install failed: Lock owner is missing or invalid; manual recovery is required: <tmp>/open-spec-mesh-locks-<uid>/install/<sha256>.lock`，而原 `recover-lock` 只认 token —— token 恰好存在那份丢失的 `owner.json` 里，用户只能手工 `rm -rf`。
- 新语义（`lib/runtime/locks.js` 的 `recoverLock(namespace, target, ownerToken, { writersStopped, allowOrphan })`）：仅当 `owner.json` 不存在（`ENOENT`）且调用方显式传 `allowOrphan: true` 时，删除该锁目录并返回 `{ recovered: true, orphan: true, directory, namespace, target }`；锁目录必须仍是非符号链接的真实目录，路径必须来自 `lockPath(namespace, target)`，不接受调用方给的任意路径；删除用非递归的 `rmdirSync`——若这个窗口里写者刚发布 `owner.json`，删除会以 `ENOTEMPTY` 失败并提示人工处理，不会连带删掉活锁。
- 新 CLI（`lib/runtime/recover-lock.js`）：`--force` 把 `allowOrphan` 置真，且**必须**同时给 `--writers-stopped`（CLI 与 `recoverLock` 两层都校验）；不带 `--force` 时 `allowOrphan: false`，孤儿锁维持原报错 `Lock owner is missing or unsafe; manual recovery is required`，仅在括号里追加可加 `--force` 的提示。成功孤儿清理输出一行 `recovered orphan lock: <dir>`；token 路径仍输出既有 JSON，`tests/node/runtime/paths-locks.test.js` 里那条 CLI 断言未改。
- 仍然 fail-closed 的部分：`owner.json` 存在时行为完全不变——token/namespace/PID 校验、PID 活着即拒绝、`--writers-stopped` 前置；`--force` 不替代 token，对「有 owner」的锁执行 `recover-lock --home <home> --force --writers-stopped` 实测 exit=1 报 `A nonempty owner token is required`，锁目录与 `owner.json` 原样保留；`withLock` 获取逻辑与 `atomicWrite` 未改动。
- 回归测试（并入 `tests/node/runtime/paths-locks.test.js`，不新建文件）：(a) 无 `owner.json` 时 `recoverLock(..., { writersStopped: true })` 抛错且锁目录仍在；(b) 加 `allowOrphan: true` 后成功、返回 `orphan: true`、目录被删除；(c) 有 `owner.json` 但 token 错、缺 token、PID 活着时，即使 `allowOrphan: true` 也一律拒绝且证据保留；(d) 未传 `writersStopped` 时任何恢复都拒绝。孤儿锁目录按真实锁规则构造：先用 `withLock` 取锁证明派生目录正确，再留下空目录。
- 实测：`node --test tests/node/runtime/paths-locks.test.js` → tests 13 / pass 13 / fail 0；`node --test tests/node/dsh/*.test.js tests/node/installation/host-adapter.test.js` → tests 26 / pass 26 / fail 0；`node scripts/check_runtime.js` → `Runtime audit passed: syntax=143, Python-sources=0, package-files=382, lock=3, static-files=92`；`node bin/osm.js validate-docs` → `docs: valid`。
- 端到端（目标建在 `$HOME/.osm-selftest-orphan/home`；不用 /tmp，它在本机是符号链接）：`withLock('install', ...)` 取锁后删掉 `owner.json` 造出空锁目录 →
  - `node bin/osm.js recover-lock --home <home> --writers-stopped` → exit=1，stderr 为 `Lock owner is missing or unsafe; manual recovery is required (if no process holds this resource, re-run with --force to remove the ownerless lock directory)`，锁目录仍在；
  - 同一命令加 `--force` → exit=0，stdout 为 `recovered orphan lock: /private/var/folders/.../open-spec-mesh-locks-501/install/<sha256>.lock`，锁目录消失；跑完 `rm -rf` 该 selftest 目录并确认已删除。
- 参数口径：`recover-lock` 仍用 `--root/--home/--db` 派生 namespace 与目标（`install` 对应 `--home`），不新增 `--namespace/--target`，避免接受调用方给的任意锁路径。
- 残余风险：若残留的是「有内容但没有 `owner.json`」的锁目录（例如 `atomicWrite` 的 `.owner.json.<pid>.<hex>.tmp` 残留），此处最初会以 `Orphan lock directory is not empty; manual recovery is required: <dir>` 拒绝；该限制已在下一节放开为"清理可清项、遇到不可清项整体放弃"。

## 父链守卫规范化与锁目录残留清理（追加，已提交、未发布）

这一节修的是同一条根因链：macOS 上 `os.tmpdir()` 给出的 `/var/folders/...` 中 `/var` 是符号链接，而安装器的写入守卫把「祖先里有符号链接」当成危险路径拒绝。

- 守卫语义变更（`lib/runtime/io.js`）：新增导出 `canonicalWritePath(target, { parentError })`（内部 `canonicalParentDirectory`）。它先向上找到已存在的祖先目录，用 `realpathSync` 规范化，再把缺失段拼回去；`atomicWrite` 头部改为 `const { target, parent } = canonicalWritePath(pathname); const destination = path.join(parent, path.basename(target));`，临时文件创建、`renameSync`、目标检查与目录 fsync 全部发生在同一个 canonical parent 内，因此不会写到规范化目录之外。
- 保留的防护逐字未动：目标是符号链接 → `Refusing symlink: <target>`；直接父目录是符号链接或不是目录 → `Refusing unsafe parent directory: <parent>`；`O_CREAT|O_EXCL|O_NOFOLLOW`、`preserveMode`、fsync、临时文件名与失败清理。
- `lib/installation/tools.js` 的 `safePath` 收敛为复用同一守卫（只换错误前缀 `Refusing symlink: <parent>`），`safeTree` 与全部安装调用点自动生效。
- `--force` 清理锁目录内残留（`lib/runtime/locks.js`）：新增 `safeOrphanEntryName` / `classifyOrphanEntry` / `clearOrphanLockDirectory`。先全量分类，只要有一项不可清就一项都不删；可清项为第一层普通文件与空子目录；每删一项前重新确认 `owner.json` 不存在并 `lstat` 复核类型；`owner.json` 这个名字永不删除；全部用 `unlinkSync` / `rmdirSync` 非递归删除。不可清时错误为 `Orphan lock directory contains entries that --force will not remove (…): <dir>; left in place: <names>`，返回值新增 `removed` 数组。
- 迁移 catalog 的路径比较（`lib/installation/migrations.js`）：原第 34 行 `if (path.resolve(root) !== path.resolve(source)) return hashes;` 与 `git rev-parse --show-toplevel` 返回的规范化路径比较，位于符号链接祖先下的项目永远不相等，于是静默丢掉历史 `AGENTS.md` blob 目录。改为两侧都走新增的 `canonicalPath(pathname)`（`realpathSync` 失败回退 `path.resolve`）。
- 测试夹具同步规范化（产品输出的是规范化路径，夹具也必须规范化）：`tests/node/installation/runtime-stage.test.js`、`tests/node/installation/skill-wrappers.test.js` 的 `mkdtempSync` 结果包一层 `realpathSync`；`tests/node/runtime/cli-runtime.test.js` 同样处理。
- 实测：`node --test tests/node/installation/*.test.js` → tests 65 / pass 65 / fail 0；`tests/node/runtime/io.test.js` → 5 / 5；`tests/node/runtime/paths-locks.test.js` → 18 / 18；`node --test "tests/node/**/*.test.js"` → tests 269 / pass 222 / fail 47（对照干净 HEAD 的 218/51）。
- 残余风险：Windows 的 junction / reparse point 未实测，本轮只在 macOS 上验证；`--force` 不清理第二层及更深的内容，也不清理符号链接、FIFO、非空子目录，遇到这些一律整项放弃并提示人工处理。

## 测试夹具规范化：47 条既有失败归零（追加，已提交、未发布）

`npm run validate:core` 在本机报 47 条红，逐簇只读诊断后收敛到与上一节同源的一条根因。

- 根因：`lib/observation/trace.js:150-158 validRealFile`、`lib/observation/store.js:27-49 ensurePrivateDirectory`、`lib/diagnostics/bundle.js:22-32 safePath`、`lib/observation/collect.js:17-26 noSymlinkPath`、`lib/observation/evaluation.js:101-106`，以及 `lib/systemone/contracts.js:172-187 hasSymlinkInPath`/`readSafeFile`、`lib/systemone/metrics.js:5-20 noSymlinkPath`，都从 `path.parse(x).root`（即 `/`）逐段 `lstat`，任一段是符号链接就拒绝。macOS 上 `/var`、`/tmp`、`/etc` 都是符号链接，而 `os.tmpdir()` 在 `/var/folders/...` 下 → 守卫在任何真实工作之前触发。
- 决定性反事实（不改一行代码）：`TMPDIR=/private/tmp/<dir> node --test tests/node/observation/*.test.js tests/node/diagnostics/bundle.test.js` → **tests 60 / pass 60 / fail 0**。因此与 sqlite / sql.js / Node 版本 / TZ / umask 均无关（另有独立验证：`sql.js` 1.14.2 可加载，`dependency-smoke` 通过；node v24.22.0 满足 `engines.node >=22`，CI matrix 亦含 24.x）。
- 裁决：**产品守卫语义不动，只规范化测试夹具基座**。12 个测试文件、37 insertions / 29 deletions，改动形式统一为 `realpathSync(await mkdtemp(path.join(os.tmpdir(), ...)))`（sync 文件同理；`manual.test.js` 用 `await fs.realpath(...)` 以不新增 import），与仓库既有先例 `tests/node/runtime/io.test.js:6`、`tests/node/installation/skill-wrappers.test.js:13`、`tests/node/dsh/install-dsh.test.js:14` 同形。`git diff -U0` 复核：被删的行只有 `mkdtemp` 与 `import` 两类，没有任何断言被改松。
- 三条「符号链接必须被拒绝」的安全断言原样保留并单独复跑通过：`tests/node/observation/store.test.js:89`（`ancestor symlink is refused before the target database is touched`）、`compatibility.test.js:154`（`artifact inputs reject symlinked trace files ...`）、`evaluation.test.js:161`（`new output and exit options retain report symlink and size safety checks`）——它们都作用在用例内部现造的 `link` 上，与「基座是否规范化」正交。
- 实测：`node --test "tests/node/**/*.test.js"` → **tests 269 / pass 269 / fail 0**（修复前 269 / 222 / 47，干净 HEAD 269 / 218 / 51）；`node scripts/check_runtime.js` → `syntax=144, package-files=382, lock=3, static-files=92`。
- 残余风险：修复后是否在 Linux/CI 上仍全绿未实测（本机无 Linux 容器、无网络），仅由「Linux 的 `/var`、`/tmp` 是真目录」与 CI 配置推断；另若日后有人把 `path.parse().root` 那段循环复制到新守卫，同样的 macOS 缺陷会再次出现。

## 已识别但未纳入本次的设计议题

以下三条是诊断期间发现、与本次验收无因果关系且需要产品决策的问题，**未修改代码**，在此登记以免丢失。

1. **守卫是否应放过系统级祖先符号链接**（`lib/observation/*` 5 处 + `lib/systemone/*` 2 处）。现状：任何位于 `$TMPDIR` 或符号链接祖先（外置盘挂载点、软链家目录）下的项目/状态目录都会被拒。安装侧在 `fe6a700` 已经选了「折叠系统祖先、只校验基座以下」；observation / systemone 侧仍是「从 `/` 一路校验」。若统一，需先定义「可信基座」（调用方给的 root / 项目根 / 家目录），并保住上面那三条拒绝断言，属需要安全评审的改动（代价 M/L）。
2. **`lib/systemone/metrics.js:20` 的失败不可观测**：路径不合法时 `writeMetric` 直接 `return false`，调用方只看到 `metrics_written: false`，与「写成功」无法区分，也没有任何诊断输出。建议补一个 `metrics_error` 之类的字段（属设计取舍）。
3. **`lib/runtime/paths.js:13-14` 的错误文本会产出误导路径**：`safeInside` 拒绝含 `..` 的相对路径时，用 `path.join(canonicalRoot, ...parts)` 拼消息，把 `../../../../../../private/var/...` 回卷成 `/private/private/var/...`，让人误以为发生了二次逃逸。改用 `path.resolve` 或直接回显原始相对串即可。

附带的结构性观察：`.github/workflows/validate.yml:22` 与 `npm-publish.yml:48` 的矩阵只有 `ubuntu-latest`，而 Linux 上 `/var`、`/tmp` 是真目录，因此这类「祖先符号链接」平台缺陷在 CI 永远不可见。是否补一个 `macos-latest` job 属独立取舍，本次未动工作流。

## 记录边界

本 Change 在 `C01-进行中`，因为修复尚未提交、尚未发版。文档只记录已发生的事实与实测输出（含失败与未验证项），不把"能挂载"写成"运行生效"，也不把未执行的验证写成通过。
