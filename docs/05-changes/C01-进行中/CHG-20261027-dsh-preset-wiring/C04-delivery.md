# DSH 预设接线修复｜交付汇总（未提交、未发版）

## 交付了什么

| 段 | 实际结果 | 证据 |
|---|---|---|
| A｜运行时接线 | persona 由路径改为 `|` 块标量内联并删除死文件；自造 `spawn_*` 工具整套删除，改为 `osm:role-routes` section + 原生 `subagent`；门控迁入 `agent/pre-step`；定级改读 `assistant/message`；`compaction/end` 重置三项状态 | [C03-01 Delivery](C03-tasks/C03-01-runtime-wiring/C03-01-02-delivery.md) |
| B｜安装器与模型配置 | 模型配置单一事实源 + 诊断；`--host dsh` 只写 `AGENTS.md` 受管章节与 `$DSH_HOME/skills`，`--with-laya` fail closed；顺带修掉 `renderMcpOverlay` 的 null 解引用；inspect 与 CLI 口径校正 | [C03-02 Delivery](C03-tasks/C03-02-installation-and-models/C03-02-02-delivery.md) |
| C｜文档与包元数据 | `engines.dsh` 写在宿主真正读取的字段；`exports`/`files` 对齐实存文件；README 与安装文档校正到 0.1.0 口径并重写 DSH 章节 | [C03-03 Delivery](C03-tasks/C03-03-docs-and-package-metadata/C03-03-02-delivery.md) |

改动规模：`git diff --stat` → 13 files changed, 408 insertions(+), 261 deletions(-)；另有未跟踪的 `tests/node/dsh/`。

## 验证证据

| 验证 | 命令 | 结果 |
|---|---|---|
| 定向单测 | `node --test tests/node/dsh/*.test.js` | tests 20 / pass 20 / fail 0（`gatekeeper.test.js`、`install-dsh.test.js`、`models-config.test.js`） |
| 静态审计 | `node scripts/check_runtime.js` | `Runtime audit passed: syntax=143, Python-sources=0, package-files=367, lock=3, static-files=92`（删除两个 locale 文件前为 369） |
| 组合层面 | `dsh --profile web --patch ./dsh/cordis.patch.yml --dump-config` | exit 0；含 `name: sdd`（:1495）、persona 内联散文（:1503）、`- id: sdd-gatekeeper / name: ./gatekeeper.mjs`（:1677-1678） |
| 挂载层面（本轮已做，零残留） | `dsh plugin --profile web add <repo>` → `--dump-config` → `remove` → `diff` | pnpm 19.3s；profile `package.json` 出现 `"open-spec-mesh": "link:/Users/zhangyefei/code/tools/open-spec-mesh"`；`--dump-config` exit 0，`name: sdd`（:1432）、`id: preset-sdd` 计数 1、persona 内联计数 1、`sdd-gatekeeper`（:1614-1615）；`remove` 后与备份 `package.json` `diff` **IDENTICAL** |

## 未验证（如实列出）

1. **安装器全流程未真跑通**：仓库无 node_modules，离线 `npm install` 挂在 `ETARGET jszip@3.10.2`；本机 node_modules 是符号链接凑版本（jszip 3.10.1 vs lock 3.10.2、smol-toml 1.9.0 vs lock 1.4.2）。`tests/node/installer.test.js` 的 7 pass/16 fail 是**改动前既有**的环境性失败，不是本次引入。
2. **`npm run validate:core` 未执行**：同上依赖缺失，无法执行；因此本次没有"全量 core 通过"这类结论。
3. **运行时 hook 未在真实会话中观察**：section 注入、pre-step 裁剪、`compaction/end` 重置只在 fake ctx 单测与 `--dump-config` 组合层面验证；真实挂载冒烟只到"预设注册 + 组合通过"，没有新开会话跑一轮。
4. **未 commit、未发版**：npm 上 `latest` 仍是 0.1.0（0.0.1/0.0.2/0.0.3/0.1.0 已发布）。

## 残余风险

- `dsh plugin add` 的成功只证明预设与插件被宿主接受并进入组合，不证明有人格注入、派发与裁剪在会话中按预期发生；若要在真实会话里确认，需要新开一个 profile 会话并按 AC3–AC5 逐项观察。
- 安装器的 dsh 分支只在单测与代码路径层面被覆盖，`AGENTS.md` 受管章节合并与 `$DSH_HOME/skills` 落盘未在真实 Home 上跑过完整流程。
- `engines.dsh >= 0.2.1-rc.4` 会把更旧的 DSH 判为不满足；该下限来自 `dsh-app-boot` 的兼容性字段语义，尚未用旧版本实测拒绝行为。

## 下一步

1. 在真实 profile 会话中按 AC3–AC5 观察一次运行时行为（技能裁剪是否只影响 L0/L1、定级是否读到 L1/L2、压缩后是否重新定级）。
2. 在依赖齐全的环境补跑 `npm run validate:core` 与 `tests/node/installer.test.js`，替换当前的"未执行"记录。
3. commit 与发版由人决定：本次未提交、未推送、未发布；发版前需要按仓库发布流程核对版本、锁文件与发布内容。

## 顺带修复（本次验收中发现的阻断，已修并复验，未发布）

真实安装链路在 macOS 默认 `TMPDIR` 下被阻断，本次一并修复并复验。

- 缺陷：`HOME=<home> node bin/osm.js install --host dsh --host-home <home>/.dsh` 在 macOS 上失败，报 `install failed: Lock owner could not be published; manual recovery is required: /var/folders/.../T/open-spec-mesh-locks-501/install/<sha256>.lock`。
- 根因：`lib/runtime/locks.js:12` 用 `os.tmpdir()` 直拼锁根目录，macOS 得到 `/var/folders/...`；`/var` 是指向 `/private/var` 的符号链接，而 `lib/runtime/io.js:39-49` 的 `atomicWrite` 从目标父目录一路上溯 `lstat` 到 `/`，任一父目录是符号链接就抛 `Refusing unsafe parent directory: /var`，于是锁的 `owner.json` 永远发不出去。把 `TMPDIR` 指到真实目录时同一命令 exit=0（父代理此前实测）。
- 修法：`lib/runtime/locks.js` 把锁根目录规范化为 `realpathSync(os.tmpdir())`（`realpathSync` 抛错时回退原值），只规范锁自己的根目录；`atomicWrite` 对**用户目标路径**的符号链接防护、`withLock` 语义、以及基于 canonical target 的锁哈希都没有改动。
- 回归测试：并入 `tests/node/runtime/paths-locks.test.js`（已有同类锁测试，不另建重复文件）。新增「symlinked TMPDIR」回归用例与「锁不可重入、释放后可再次获取」用例；原有三处按 `tmpdir()` 拼锁目录的断言改为按 `realpathSync(tmpdir())` 计算，`tempRoot()` 同步改用真实路径——`atomic bytes replace...` 用例此前在 macOS 上因同一 `/var` 符号链接失败，属既有环境性失败，不是本次引入。
- 复验：`node --test tests/node/runtime/paths-locks.test.js` → tests 9 / pass 9 / fail 0；把 `lockBase` 临时改回 `path.join(os.tmpdir(), ...)` 后新回归用例失败并复现同一条 `Refusing unsafe parent directory` 报错，改回后恢复通过。`node --test tests/node/dsh/*.test.js tests/node/installation/host-adapter.test.js` → tests 26 / pass 26 / fail 0。
- 端到端：在 `$HOME/.osm-selftest`（不用 `/tmp`，它是符号链接）下建 `home/.dsh` 与 `proj`，**不覆盖 `TMPDIR`** 跑 `install --host dsh`，exit=0，输出 `installed: /Users/zhangyefei/.osm-selftest/home/.dsh`，`<home>/.dsh/skills` 出现 `sdd-*`（`sdd-close`、`sdd-design`、`sdd-do`、`sdd-init`、`sdd-migrate` 等）；跑完 `rm -rf` 该目录并确认已删除。
- 残余风险：发布失败时故意保留的锁目录（无 `owner.json`）不会自动清理，需人工删除；本次复验就被上一次复现留下的此类孤儿目录挡过一次，报 `Lock owner is missing or invalid; manual recovery is required`，人工 `rm -rf` 那个 `.lock` 目录后 exit=0。同类符号链接风险：任何把 `os.tmpdir()` 结果直接交给 `atomicWrite` 的路径都会在 macOS 上踩同一个坑，本次只修锁根目录。

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
- 残余风险：若残留的是「有内容但没有 `owner.json`」的锁目录（例如 `atomicWrite` 的 `.owner.json.<pid>.<hex>.tmp` 残留），`--force` 会以 `Orphan lock directory is not empty; manual recovery is required: <dir>` 拒绝而不是递归删除，仍需人工处理。

## 记录边界

本 Change 在 `C01-进行中`，因为修复尚未提交、尚未发版。文档只记录已发生的事实与实测输出（含失败与未验证项），不把"能挂载"写成"运行生效"，也不把未执行的验证写成通过。
