# 日常运行指南

**主线**：Quick 直接完成；需要 Worker 分工时进入 SDD，由 Architect 规划，Worker 实现，Main 验收。Codex、OpenCode、Claude Code 共享同一 SDD runtime；宿主只改变 Skill/Agent/session 的承载方式。模型写决策与解释，脚本维护身份、文件清单和状态。

## 工件分工

| 内容 | 维护方式 |
| --- | --- |
| Quick | Main 连续完成；可用 Explorer / Librarian 调查；不建 Change / Task |
| SDD Change / Design | Architect 定义目标、范围、AC；Design 保存跨 Task 公共设计、公共不变量、Task 关系与设计落点 |
| SDD Task Graph | Architect 直接生成；Task Design 保存各 Task 本地详细设计与 Worker 自由度 |
| baseline、attempt、文件路径与操作 | 脚本生成；Worker 补逐文件影响和真实验证 |
| 图状态与导航 | 使用创建、派发、交付、收口脚本；不手工改图或重复抄写索引 |

Task、Delivery、图和索引继续存在，保护不变；少的是人为模式和重复编写，不是校验。

## 宿主入口

安装后先确定宿主的 Skill 根：

```sh
# Codex
SKILL_ROOT="${CODEX_HOME:-$HOME/.codex}/skills"

# OpenCode
SKILL_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/skills"

# Claude Code
SKILL_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
```

OpenCode 主会话使用 `opencode --agent main`；需要 Research MCP 时同时设置 `OPENCODE_CONFIG=<config-home>/open-spec-mesh.opencode.json`。Claude Code 使用 `claude --agent main --mcp-config <config-home>/open-spec-mesh.mcp.json`。非 Codex Agent 默认继承宿主模型，不写入 Codex model 名。

三宿主的 Worker 都必须在 `prepare` 返回的 workspace 中运行；不要启用宿主自动 worktree。Leaf/session 细节见 [leaf-execution](../../sdd-do/references/leaf-execution.md)。

## 日常动作

`SDD` 指向源码或已安装技能中的 `sdd-change/scripts/sdd.py`。以下变量取当前派发值；多 Task 时给每条命令加 `--task "$TASK"`，不会自动猜选。

在派发前可先查看当前状态和机械上允许的动作：

```sh
python3 "$SDD" status "$CHG" --root "$PROJECT"
```

`status` 不做语义决策，只返回 `planning_ready`、Task 状态、等待依赖、已有 `agent_session` 与 `allowed_actions`；Main 仍按派发契约决定真正的下一步。

```sh
SDD="$SKILL_ROOT/sdd-change/scripts/sdd.py"
```

### prepare：Main 准备实施

先让 Architect 用 [sdd-change](../../sdd-change/SKILL.md) 完成 C01 Change、C02 Design、C03 Task Graph 和全部 Task Design，再运行：

```sh
python3 "$SDD" prepare "$CHG" --root "$PROJECT"
```

prepare 只消费 Architect 已定义的 Task，不自动派生或替 Main 拆任务。Main 对每个 ready Task 使用 `--task "$TASK"` 做机械校验、冻结并返回工作区、baseline / attempt，不修改 Task 边界或设计。返回值同时包含 `dispatch`：它直接引用 C01 Change / C02 Design / 当前 Task Design、依赖与运行身份，用于拼接 Worker 的动态唤起 Prompt，Main 不再重新摘要 Task。需要隔离才加 `--worktree`；恢复运行中 Task 返回 `resume: true`。

Worker 首次 spawn 成功后，记录返回的会话 / thread id：

```sh
python3 "$SDD" bind-session "$CHG" --root "$PROJECT" --task "$TASK" --agent-session "$THREAD_ID"
```

Planning 文档保留 Design / Task 的全部固定维度与标题；某维度无变化时标题下直接写“无变化。”，不生成空表。表格已表达的事实不再用正文重复；公共设计只在 Design 展开，Task 引用 Dxxx 后只写本地落实。

绑定只用于后续恢复原上下文；不能覆盖成另一个会话，也不是身份认证。多个 ready Task 只要依赖满足即可并行；并行写任务必须各自使用独立 worktree。Path Contract 可以重叠，低/中度重叠留给 Main 集成；高度重合或存在真实语义先后时由 Architect 用 depends_on 串行。依赖 Task 即使已 accepted，只要其 `result_revision` 尚未进入当前 HEAD，`status` 仍阻止下游 `prepare`。完整 Design 和全部 Task Design 必须在首次实现前完成并可 Review；不得等 ready 后补设计。Worker 默认读取 Change + Design + 自己的 Task Design。Design / Graph / Task Design 的 depends_on、AC、Dxxx 引用不一致时拒绝派发。

### deliver：Worker 提交交付

先提交实际改动。第一条会根据真实 Git diff 自动生成文件行，根据 Task Contract 自动生成全部 AC 行，并生成固定字段骨架；Worker 只补交付结果、行为影响、实际检查和证据。已有完整结构化证据可直接用第二条。

```sh
python3 "$SDD" deliver "$CHG" --root "$WORKSPACE" --attempt "$ATTEMPT" --evidence-file "$EVIDENCE_MD" --draft
python3 "$SDD" deliver "$CHG" --root "$WORKSPACE" --attempt "$ATTEMPT" --evidence-file "$EVIDENCE_MD"
```

默认读取 `HEAD`，可用 `--revision` 指定已提交版本。草稿不覆盖已有文件，含占位内容不能交付；必须保留派发时的 attempt，不能自行读取新轮次冒领。Delivery 固定五节，并使用固定字段/枚举；Task 的每个 AC 必须且只能有一行结果。`部分通过 / 未通过` 可以作为真实 Delivery 提交，但失败/未执行 AC、未验证项、契约偏差或非“通过”结论都会阻止后续 Acceptance。交付时仍用真实 Git diff 检查 Path Contract；Worker 只运行当前 Task 的定向测试和必要 build/static check。

### integrate：Main 波次集成

Task accepted 后可按单 Task 或当前 wave 做确定性集成。单 Task：

```sh
python3 "$SDD" integrate "$CHG" --root "$PROJECT" --task "$TASK" --check
python3 "$SDD" integrate "$CHG" --root "$PROJECT" --task "$TASK"
```

同一 wave 有多个 accepted/pending Task 时优先：

```sh
python3 "$SDD" integrate "$CHG" --root "$PROJECT" --wave --check
python3 "$SDD" integrate "$CHG" --root "$PROJECT" --wave
```

`status` 的 `integration` 由 Git ancestry 实时推导，不写入 Task Graph：`accepted + result_revision ancestor HEAD = integrated`，否则为 `pending`。wave 候选同样不持久化，只按 Graph 顺序从 accepted/pending Task 派生；`--wave --check` 在一个 detached worktree 中链式 merge 整个 wave，因此可在写 Main 前发现 Task 之间的冲突。实际集成继续使用保留 Task `result_revision` ancestry 的 merge commit；active Change 的权威运行工件以 Main 当前快照为准，不接受 Worker 工作区里的旧 Graph 覆盖。外部代码冲突返回精确文件；简单冲突由 Main 解决，复杂语义冲突回派原 Worker。存在 `depends_on` 时按 **Execution Wave → Integration Wave → Next Wave** 推进。

### close：Main 验收与归档

Main 完成验收判断后，自动 submit 或导入原 worktree 报告并登记接受：

```sh
python3 "$SDD" close "$CHG" --root "$PROJECT" --accept --reason "已核对版本、AC 与实际验证"
```

随后 Main 用上面的 `integrate` 完成当前 wave；存在下游依赖时，先让上游 accepted result 进入 HEAD，再派发下一 wave。全部 Task 最终集成后，Main 将完整 integrated diff、历次 Delivery 和验收结果交 Architect 同步受影响 Current Truth，核对后把实现与快照提交到同一个最终 HEAD。

最终验证前退役已完成的 Worker worktree：仅移除已提交且 Delivery 已导入/验收的干净工作区；有未提交实现/证据时先保全，不使用 `--force`。完成后执行 `git worktree prune`，避免已结束 Worker 的 Git 元数据污染项目级测试/清理。再把最终 HEAD 写入 `integrated_revision`，运行唯一机器验证入口：

```sh
python3 "$SKILL_ROOT/sdd-close/scripts/run_validation.py" \
  "$CHG" --root "$PROJECT" --revision "$INTEGRATED_REVISION"
```

项目在 `docs/08-quality/Q01-validation.md` 中声明一个版本化 Python `Validation Entry Point`，由它串行执行项目全部 required tests/build/static checks。任一失败都必须修到通过，不保留 known-failure / baseline-failure 豁免。验证 receipt 绑定 Change、最终项目 revision、入口摘要和退出码；验证后只允许继续补 active Change 的收口证据。实现或 Current Truth 再变化就必须更新 revision 并重跑。全绿后填写 Change 收口字段和人类可读证据并运行：

```sh
python3 "$SDD" close "$CHG" --root "$PROJECT" --archive
```

所有前提已满足时可合并 `--accept --archive`。归档不会自动合并代码、补写 pass 或代替业务判断。

## 恢复与兼容

- **普通返工**：汇总反馈，原 Worker rework；优先使用 Task 保存的 `agent_session` 恢复原 Agent，复用工作区时用 prepare 的 `--reuse` 与明确基线，不自动 reset / rebase。
- **契约变化**：先停止并取得用户确认，再由原 Architect 修订 Design / Graph 并 replan。
- **中途失败**：已完成的有效阶段保留，从失败处重试；不得把“已接受但尚未集成”说成归档完成。
- **旧记录**：历史旧版模式工件和诊断数据可继续读取，但新执行只使用 Quick / SDD。

具体返工、replan 与低层命令保留在 [Task 协议](../../sdd-change/references/task-graph.md)。正常任务不需要逐条拼装这些操作。
