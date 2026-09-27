# 执行行为诊断

## 定位

使用已有执行证据和确定性规则回答流程/委派问题，**不增加诊断模型调用、不追加 Agent 埋点提示词**。

## Host 能力

| Host | Native trace | 可确定采集 |
| --- | --- | --- |
| Codex | full | rollout、子会话、命令、委派、model/effort、usage、SDD artifacts |
| OpenCode | unsupported | 当前 Rules / Agent / Skill 指纹、显式 Change / Task Graph |
| Claude Code | unsupported | 当前 Rules / Agent / Skill 指纹、显式 Change / Task Graph |

非 Codex 当前使用 artifact-only collect：`coverage.status=partial` 并记录 `<host>_native_trace_unsupported`。没有稳定私有 trace adapter 时，不把“没看到 spawn / Skill read / SDD command”写成未发生。

## 存储

Observation 数据库使用宿主无关状态根：`OPEN_SPEC_MESH_STATE_HOME`，否则 `XDG_STATE_HOME/open-spec-mesh`，再缺省到 `~/.local/state/open-spec-mesh`。不再默认写入 Codex Home。

## 使用入口

[一键诊断技能](../../../sdd-diagnose/SKILL.md) · [原始 CLI 与诊断规则](../../../sdd-do/references/observation.md)。

Codex `scan` 保持原 full-trace 能力；OpenCode/Claude 私有 trace `scan` 当前明确拒绝。非 Codex 可用 `collect --host ...` 做 artifact snapshot。完整诊断包对私有执行 trace 的深度仍以 Codex 为基线，不虚构跨宿主等价事件。

## 边界

当前文件指纹不证明历史加载；unknown / partial 不计为通过或失败。诊断不从思维链解释动机、不自动修改规则或授权边界。
