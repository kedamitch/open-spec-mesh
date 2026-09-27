# 日常运行指南

**主线**：Quick 直接完成；需要 Worker 分工时进入 SDD，由 Architect 规划，Worker 实现，Main 验收。模型写决策与解释，脚本维护身份、文件清单和状态。

## 工件分工

| 内容 | 维护方式 |
| --- | --- |
| Quick | Main 连续完成；可用 Explorer / Librarian 调查；不建 Change / Task |
| SDD Change / Design | Architect 定义目标、范围、AC；Design 保存跨 Task 公共设计、公共不变量、Task 关系与设计落点 |
| SDD Task Graph | Architect 直接生成；Task Design 保存各 Task 本地详细设计与 Worker 自由度 |
| baseline、attempt、文件路径与操作 | 脚本生成；Worker 补逐文件影响和真实验证 |
| 图状态与导航 | 使用创建、派发、交付、收口脚本；不手工改图或重复抄写索引 |

Task、Delivery、图和索引继续存在，保护不变；少的是人为模式和重复编写，不是校验。

## 日常动作

`SDD` 指向源码或已安装技能中的 `sdd-change/scripts/sdd.py`。以下变量取当前派发值；多 Task 时给每条命令加 `--task "$TASK"`，不会自动猜选。

在派发前可先查看当前状态和机械上允许的动作：

```sh
python3 "$SDD" status "$CHG" --root "$PROJECT"
```

`status` 不做语义决策，只返回 `planning_ready`、Task 状态、等待依赖、已有 `agent_session` 与 `allowed_actions`；Main 仍按派发契约决定真正的下一步。

```sh
SDD="${CODEX_HOME:-$HOME/.codex}/skills/sdd-change/scripts/sdd.py"
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

绑定只用于后续恢复原上下文；不能覆盖成另一个会话，也不是身份认证。多个 ready Task 只要依赖满足即可并行；并行写任务必须各自使用独立 worktree。Path Contract 可以重叠，低/中度重叠留给 Main 集成；高度重合或存在真实语义先后时由 Architect 用 depends_on 串行。依赖 Task 即使已 accepted，只要其 `result_revision` 尚未进入当前 HEAD，`status` 仍阻止下游 `prepare`。完整 Design 和全部 Task Design 必须在首次实现前完成并可 Review；不得等 ready 后补设计。Worker 默认读取 Change + Design + 自己的 Task Design。Design / Graph / Task Design 的 depends_on、AC、Dxxx 引用不一致时拒绝派发。

### deliver：Worker 提交交付

先提交实际改动。需要文件表草稿时运行第一条，补齐改动点和验证后运行第二条；已有完整证据可直接用第二条。

```sh
python3 "$SDD" deliver "$CHG" --root "$WORKSPACE" --attempt "$ATTEMPT" --evidence-file "$EVIDENCE_MD" --draft
python3 "$SDD" deliver "$CHG" --root "$WORKSPACE" --attempt "$ATTEMPT" --evidence-file "$EVIDENCE_MD"
```

默认读取 `HEAD`，可用 `--revision` 指定已提交版本。草稿不覆盖已有文件，含占位内容不能交付；必须保留派发时的 attempt，不能自行读取新轮次冒领。交付时会用真实 Git diff 机械检查 Task Path Contract；兄弟 Task 的路径重叠不会被视为越界。Worker 只需要运行当前 Task 的定向测试和必要 build/static check。此动作只写 Worker 报告，不推进 Main 的 submitted / accepted 状态。

### integrate：Main 波次集成

Task accepted 后先做只读预检，再执行确定性集成：

```sh
python3 "$SDD" integrate "$CHG" --root "$PROJECT" --task "$TASK" --check
python3 "$SDD" integrate "$CHG" --root "$PROJECT" --task "$TASK"
```

`status` 的 `integration` 由 Git ancestry 实时推导，不写入 Task Graph：`accepted + result_revision ancestor HEAD = integrated`，否则为 `pending`。实际集成使用保留 Task `result_revision` ancestry 的 merge commit；active Change 的权威运行工件以 Main 当前快照为准，不接受 Worker 工作区里的旧 Graph 覆盖。外部代码冲突返回精确文件；简单冲突由 Main 解决，复杂语义冲突回派原 Worker。存在 `depends_on` 时按 **Execution Wave → Integration Wave → Next Wave** 推进。

### close：Main 验收与归档

Main 完成验收判断后，自动 submit 或导入原 worktree 报告并登记接受：

```sh
python3 "$SDD" close "$CHG" --root "$PROJECT" --accept --reason "已核对版本、AC 与实际验证"
```

随后 Main 用上面的 `integrate` 完成当前 wave；存在下游依赖时，先让上游 accepted result 进入 HEAD，再派发下一 wave。全部 Task 最终集成后，Main 将完整 integrated diff、历次 Delivery 和验收结果交 Architect 同步受影响 Current Truth，核对后把实现与快照提交到同一个最终 HEAD；再把该 HEAD 写入 `integrated_revision`，运行唯一机器验证入口：

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/sdd-close/scripts/run_validation.py" \
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
