---
name: typesafe-laya
license: MIT
description: 当同一种语义判断需要批量或反复执行时，复用 Laya 命名模板；或借鉴 typesafe-ai 方法定义并验证新模板。支持执行模式、是否委派和角色匹配，也自主发现其他重复判断。明确、一次性或确定性问题直接处理，不把 Laya 变成每轮前置步骤。
---
# 定义一次，反复执行

**适用**：判断方式稳定、输入已可取得、结果能减少后续分析或不必要交接。高频本身不保证收益；不要先完整判断，再让 Laya 重复确认。

**默认 provider**：仅使用 Laya。Jev 以及上游 TypeSafe/Jev skill 不会被本技能自动启用；只有操作员显式设置 `SYSTEMONE_PROVIDER=jev` 时才走 Jev transport。

**分工**：脚本处理规则与相同输入缓存；Laya 执行固定语义判断；Codex 定义新判断、处理复杂问题与回退。不要为调用小模型重新总结长上下文。

## 使用已有判断

先根据已知模板选择；不清楚可用模板时调用一次 `laya_templates`，无需先调用 `laya_status`。后者只用于用户明确要求的连通性排错。

调用 `laya_decide`，不是每次重写 questions：

```json
{
  "decision": "execution-mode@1",
  "items": [
    {"id": "job-1", "state": {"request": "需求已确定，可拆成前后端两个独立 Task 并行实现。"}},
    {"id": "job-2", "state": {"request": "修正一个明确的局部问题，由当前角色连续完成即可。"}}
  ],
  "context": {"facts": "无已知未决产品行为"}
}
```

- `decision`：已存在的 `name@version`。当前内置 `execution-mode@1`、`delegation@1`。
- `items`：1–16 个 `{id, state}`；id 唯一，state 为已有事实对象。
- `context`：可选共享事实；条目同名字段覆盖共享字段。不要将未确认推断填成事实。
- `model`：可选 provider 模型；省略或 auto 时，Laya 使用 `LAYA_MODEL`（默认 multilingual），Jev 使用 `TYPESAFE_DEFAULT_MODEL`（默认 jev-latest）。不是 Codex 主模型。
- `delegation@1` 要求 `current_role`、`available_roles`；调用方只传**自己允许委派的候选**和必要状态。运行时会再次按当前角色与状态过滤，模型只看到过滤后的局部候选；候选不能扩权。示例见 [运行协议](references/runtime.md)。

模板与工具入口与 provider 无关。默认只使用 Laya；Jev 默认关闭，只有操作员显式设置 `SYSTEMONE_PROVIDER=jev` 才可使用。Laya 对 1–16 个状态统一走 `/v1/systemone/batch`；Jev 按官方协议对每个不同状态调用一次 `/v1/systemone`。服务不可用时回退，不自动切换 provider。

## 采用结果

按 `results[].id` 对齐；`status=ok` 的条目含 recommendation 与 basis（model / cache / 已有状态规则）。结果只是建议，不是执行或授权。顶层 partial 时保留有效条目，其余由原角色继续。

`fallback`、uncertain、无效候选或与已知事实冲突：由当前角色继续原流程，不循环追问 Laya、不自动转调 Jev。工具缺席或被关闭时不检查服务、不索要密钥、不阻塞任务。

人工阶段确认、验收和模式边界仍由用户与当前 Agent 负责；建议不构成授权。delegation@1 不维护一份给所有 Agent 读取的全局路由说明，只在内部做权限过滤；每个角色只根据自己的 Prompt 决定可委派对象。

## 定义新的重复判断

不限两个内置场景。发现一批同类判断或持续重复的选择时，按 [模板设计](references/design.md) 定义并验证一次，再使用命名模板执行。一次性新问题通常直接处理，不自动扩大成模板工程。

复用 typesafe-ai 的 state / instructions / criteria、独立问题组合和不确定性处理；只替换为本仓库 Laya MCP 协议。不覆盖已安装 typesafe-ai，不引入其 SDK、Jev 或额外密钥。来源及 MIT 许可见 [适配记录](references/upstream.md)。
