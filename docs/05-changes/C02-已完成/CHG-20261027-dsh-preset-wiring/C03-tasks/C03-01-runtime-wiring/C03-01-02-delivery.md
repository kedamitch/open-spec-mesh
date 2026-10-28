# C03-01｜运行时接线交付

## 实际改动

- `dsh/cordis.patch.yml`：`prefix` 由 `./prompts/sdd-persona.md` 改为 `prefix: |` 块标量内联（`:14`，正文 `:15`–`:63`）；persona 内 5 处 `spawn_*` 改为"按路由表用原生 `subagent` 显式传 provider/model/reasoning_effort"；定级行规范为 `【定级】Level: <L0 | L1 | L2> | 判定依据:`；新增第 4 条红线（`:63`）。
- `dsh/prompts/sdd-persona.md`：删除（47 行）。
- `dsh/gatekeeper.mjs`：删除自造 `spawn_*` 工具与 `ctx.tools?.subagent?.call?.()`；新增 `ROLE_ROUTES_SECTION`（`:19`）与 section 注册（`:158`）；门控迁入 `agent/pre-step`（`:170`，`{prepend:true}`），技能裁剪限定 `source.kind === 'skill-catalog'`（`:205`）并保留 `source.entries`；定级改为 `detectLevelFromSession`（`:113`，调用点 `:178`）；`compaction/end` 重置三项状态（`:217`）。

## 验证与自审

- `dsh --profile web --patch ./dsh/cordis.patch.yml --dump-config`：exit 0；输出含 `name: sdd`（:1495）、persona 内联散文（:1503）、`- id: sdd-gatekeeper / name: ./gatekeeper.mjs`（:1677-1678）。
- `node --test tests/node/dsh/*.test.js`：tests 20 / pass 20 / fail 0（含本段 `gatekeeper.test.js`）。
- 自审要点：裁剪只改技能目录消息，未触碰 `source`/`baseline`/`baselineIdentity`；等级匹配只读 `assistant/message`，不会把 user 消息误当判定输入。

## 风险与快照影响

本段证据只到 fake ctx 单测与 dump-config 组合层面。真实会话中的 section 注入、pre-step 裁剪与压缩重置未观察，列入 [C04-delivery.md](../../C04-delivery.md) 的未验证清单。此 Delivery 是事实记录，不是人工验收。
