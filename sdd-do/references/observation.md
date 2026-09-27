# 执行行为诊断

纯 Python 标准库、离线、只读采集。**不调用模型、宿主 CLI、网络 API，不注入提示词、不新增 Skill，也不让 Agent 手写日志。** 诊断独立于开发流程运行；失败不改变 Task、代码或验收状态。

## Host 能力

| Host | Native trace | Rules | 边界 |
| --- | --- | --- | --- |
| Codex | full | `$CODEX_HOME/AGENTS.md` | 保持现有 rollout / child session 解析 |
| OpenCode | unsupported | `$OPENCODE_CONFIG_DIR/AGENTS.md` | 只采集当前规则/Skill/Agent 与 SDD artifact snapshot |
| Claude Code | unsupported | `$CLAUDE_CONFIG_DIR/CLAUDE.md` | 只采集当前规则/Skill/Agent 与 SDD artifact snapshot |

OpenCode / Claude Code 在私有 trace adapter 尚未稳定前明确记录 `coverage.status=partial`，不会从“没看到 spawn / Skill read / SDD command”推断它们没有发生。

## 使用

安装器自动把 `observe.py` 和 `observation/` 安装到现有 `sdd-do/scripts/`。默认数据库改为宿主无关位置：优先 `$OPEN_SPEC_MESH_STATE_HOME/observations.sqlite3`；否则使用 `$XDG_STATE_HOME/open-spec-mesh/observations.sqlite3`，再缺省到 `~/.local/state/open-spec-mesh/observations.sqlite3`。

```sh
OBSERVER="${CODEX_HOME:-$HOME/.codex}/skills/sdd-do/scripts/observe.py"  # Codex 示例

# 一次扫描本项目的历史根会话；每个原生 turn 单独成片段，不推测多个需求的关系。
python3 -B "$OBSERVER" scan --root "$PWD" --since 2026-09-23

# scan 输出 run_id；查看诊断及跨版本汇总。
python3 -B "$OBSERVER" report --run <run_id>
python3 -B "$OBSERVER" summary
```

针对“这次为什么没有 Explorer／没有按 SDD 执行”，用操作者期望补齐适用条件，而不是让模型解释动机：

```sh
python3 -B "$OBSERVER" collect --run inspect-one --root "$PWD" \
  --session-file /absolute/path/rollout.jsonl \
  --sessions-dir "${CODEX_HOME:-$HOME/.codex}/sessions" \
  --turn <turn_id> --expected-mode sdd --expect-role explorer \
  --change CHG-YYYYMMDD-example
python3 -B "$OBSERVER" report --run inspect-one --format json

# 明确属于同一需求的多个片段可分组；不重复累计同一 Task 的历史。
python3 -B "$OBSERVER" group --run feature-one --members <run_a> <run_b>
python3 -B "$OBSERVER" report --run feature-one
```

`--turn` 在根会话含多个 turn 时必须给出；单 turn 可省略。`--change`、期望模式和期望角色均可省略，此时保留 unknown，不猜用户意图。没有明确绑定时，只从成功 SDD 命令里的唯一 Change ID 关联。原生 thread、一次 turn、SDD Task 和最终需求不是同一个对象。

源码测试可加 `--rules-root <package-root>`；已安装环境按 `--host` 选择对应配置根。自定义数据库参数放在子命令前：`observe.py --db /private/data/observations.sqlite3 scan ...`。数据库必须在项目外且权限为 0600。

OpenCode / Claude Code 当前使用 artifact-only collect，不读取私有 session DB：

```sh
python3 -B "$OBSERVER" --host opencode collect \
  --run inspect-open --root "$PWD" --expected-mode sdd --change CHG-YYYYMMDD-example

python3 -B "$OBSERVER" --host claude collect \
  --run inspect-claude --root "$PWD" --expected-mode sdd --change CHG-YYYYMMDD-example
```

非 Codex `scan` 当前明确拒绝；不能把未知私有 trace 当成空 trace。

## 采集与证据

| 输入 | 提取 | 不做的推断 |
| --- | --- | --- |
| Codex 原生 rollout JSONL | 根/子会话、turn、调用和结果、原生命令/委派事件、实际 model/effort、累计用量样本 | 无调用记录不等于工具不可用；调用不等于完成 |
| OpenCode / Claude 当前 artifact snapshot | 当前规则、Agent、Skill、显式 Change / Task Graph | 不生成缺失委派/Skill/命令的负面判断；native trace 保持 unknown |
| 指令注入记录 | 规则指纹、已支持的路由表信号及行号 | 无 cat AGENTS.md 不等于未加载；不读取思维链 |
| 当前规则/角色/Skill 文件 | 指纹、文件状态、角色配置；无正文副本 | 当前存在不等于该轮加载；事后指纹不能证明历史版本 |
| 显式关联的 Change/Task Graph | 当前状态、attempt、history、版本字段 | 旧 history 无时间则 unknown，不用采集时间补成执行时间 |

支持原生 `session_meta` / `turn_context` / `event_msg` / `response_item`，包括 namespaced function calls、原生命令 begin/end、spawn begin/end 和已识别的 sub-agent activity。Code Mode 的任意 JavaScript 不执行、不靠正则解释；若无对应原生事件，则标为 opaque。未知格式、截断日志、缺少子会话/结束事件均降低覆盖。

默认不会保存对话、思维链、源码、原始命令、工具输出、凭据或绝对路径。仅保留筛选后的 ID、状态、计数、文件/内容指纹和证据位置。原始证据定位为 `session:<thread_id>:L<n>`，Task 历史用 JSON locator；源文件摘要用于核对版本。观察库仍包含项目执行元数据，应保持私有。

## 确定性诊断

| 规则 | 检查对象 | 结论边界 |
| --- | --- | --- |
| D01 / D02 | 委派实际失败；当前 Quick/SDD 调查权限与旧限制规则冲突 | 区分工具失败与规则限制；当前文件限制不证明当轮已加载 |
| D03 / D04 | 期望角色未观察到；叶子角色实际发起委派 | 未调用是待复核；实际动作对照当轮约束，不自动归罪模型 |
| S01 / S02 / S03 | SDD 未观察到、Change 当前缺失、SDD 命令失败 | 失败有正证据；缺席/缺失先核对关联和版本 |
| S04 / S05 / S06 | 同身份步骤逆序、写入早于 Change、Worker 对应图当前缺失 | 时序和工件候选，排除跨 attempt、旧 Change 或关联错误后再处理 |
| P01 / P02 / P03 | Skill 显式读取未知、全局/项目规则重复、未知路由变体 | 加载不等于遵循；不通过关键词理解所有提示词 |
| C01 | 不完整/不支持的观测 | 不计为通过，不把缺失用量记为零 |

每项输出：**结论、证据、分类、最小修正建议**。建议是固定规则模板，既不调用 LLM，也不自动改 AGENTS/角色/Skill。不要用文件数、调查次数或用量多少单独证明应该调用 Explorer 或进入 SDD。

## 指标与比较

记录委派尝试/成功/失败/未知、恢复、显式 Skill 读取、成功 SDD 命令、可归因的首轮验收、直接返工/依赖失效、replan、根片段墙钟时长和用量覆盖率。比率保留分子/分母，零样本不输出“100%”。

累计用量采用末值减窗口前基线，不相加重复采样；fork/子会话缺基线时 unknown。并行会话耗时不相加为任务总耗时；不估算账单。分组报告是显式视图，不再作为额外执行样本进入 summary；更新成员后重新 group。summary 的 Task 指标按项目和 Change 的最新快照去重，不能按每个 turn 重复累计。

版本汇总按期望模式和**事后配置指纹**分组，不宣称因果关系。脚本不能判断自然语言需求是否正确、某次调查是否值得委派，或一条提示词贡献多少收益；这些保持人工待复核，不用模型补解释。

## 运行约束与验证

单文件上限 128 MiB、单行 8 MiB；scan 默认最多 100 个片段，超限失败而不是静默漏统计。只读取无符号链接输入。数据库按 Run 原子替换；重复采集不增加样本，不兼容数据库或不同 scope 复用同 run_id 时拒绝。批量是逐 Run 提交，重跑可恢复；未增加后台进程或自动外传。

```sh
python3 -B -m unittest discover -s tests -p 'test_observation.py' -v
```

适配依据：[Codex rollout-trace agent reducer](https://github.com/openai/codex/blob/0a2eb4696c26ac33204bcd255721ab30220a4774/codex-rs/rollout-trace/src/reducer/tool/agents.rs)、[AGENTS 指令加载](https://developers.openai.com/codex/guides/agents-md/)、[Skill 渐进加载](https://developers.openai.com/codex/skills/)。本地历史格式可能不同；适配器按观测形状工作，不声称覆盖所有客户端版本。
