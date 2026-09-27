# Task 运行协议

权威任务图只由 SDD Architect 创建。Main 负责运行时状态、冻结、派发和验收，但不得重新拆分、合并或转译 Architect 已交付的 Graph。Worker 只写自己的交付。

图结构保持最小：Task ID、Task 路径、`depends_on`、状态和运行元数据，不增加 `parallel_group`、文件锁或路径互斥字段。AC 与验收语义只在 Change / Task Design 定义，不在 Graph 重复保存。Design 保存跨 Task 公共设计、Task 关系与设计落点；每个 Task Design 保存自己的详细设计、Path Contract 和 Worker 自由度。

Task 优先按业务模块/完整业务结果拆分。Path Contract 可以重叠：它只保护当前 Worker 不越界，不表示兄弟 Task 不能并行。低/中度重叠可使用独立 worktree 并行，最终由 Main 集成；高度重合、合并成本明显高或存在真实语义先后时，通过 `depends_on` 串行。

以下命令在源码技能根执行；安装后使用 `$CODEX_HOME/skills/` 下对应脚本。`PROJECT` 是主工作区，`WORKTREE` 是已分配工作区，`CHG / TASK / ATTEMPT` 取实际派发值。

## 1. 冻结与派发

```sh
python3 sdd-change/scripts/task_graph.py --root "$PROJECT" --change "$CHG" --task "$TASK" --action approve
python3 sdd-do/scripts/prepare_workspace.py "$CHG" "$TASK" --root "$PROJECT" --worktree "$WORKTREE"
```

单 Worker 串行任务无隔离需要可省略 `--worktree`；多个写 Task 并行时必须分别分配独立 worktree。approve 先检查真实正文、Path Contract、明确占位和完整前置设计。唯一合法格式要求 Design Task 行、Task Graph、Task Design 的 `depends_on` 完全一致，Task 的 AC / Dxxx 引用也必须一致；任一 Task 的详细设计未完成都不得先派发其他 Task。只有当前 C01/C02/C03 结构可执行；其他结构直接拒绝。

approve 对 canonical Task 使用 scoped digest：冻结 Change 的共享目标/范围/约束 + 当前 Task 引用的 AC，Design 的公共设计/整体停止条件 + 当前 Task 引用的 Dxxx + 当前 Task 关系行，以及当前 Task Design 全文。未被当前 Task 引用的其他 AC / Dxxx / 兄弟 Task 关系变化不会直接使它 stale；依赖 Task 变化仍通过 Graph 向下游传播。prepare 核对上游 accepted 且结果已进入 baseline，生成 attempt。

派发带目标、scope、AC、依赖、baseline / attempt、工作区和必要证据。Worker 的设计上下文固定为 Change + 共享 Design + 自己的 Task Design：Design 提供公共约束和 Task 关系，Task Design 提供本地详细设计。默认不需要读取其他 Task Design，也不另写执行计划。工作区只同步规划文件、索引与图快照，不覆盖实现或已有报告。

## 2. 交付与验收

Worker 先提交源码，再在分配的工作区执行：

```sh
python3 sdd-do/scripts/record_delivery.py "$CHG" "$TASK" --root "$WORKTREE" --revision HEAD --attempt "$ATTEMPT" --evidence-file "$EVIDENCE_MD"
```

Main 导入报告并 submit，然后验收：

```sh
python3 sdd-do/scripts/import_delivery.py "$CHG" "$TASK" --root "$PROJECT" --from-workspace "$WORKTREE"
python3 sdd-do/scripts/record_acceptance.py "$CHG" "$TASK" accept --root "$PROJECT" --reason "已核对版本、AC 和证据"
```

同工作区可直接 `task_graph.py --action submit`。导入核对工作区、契约、baseline、attempt、Git 祖先关系和文件表，只复制当前报告，不导入 Worker 的任务图。submitted 不解锁下游；accepted 只表示验收完成，若存在后续依赖还必须先进入 Main HEAD。

单 Task 可显式预检/集成：

```sh
python3 sdd-change/scripts/sdd.py integrate "$CHG" --root "$PROJECT" --task "$TASK" --check
python3 sdd-change/scripts/sdd.py integrate "$CHG" --root "$PROJECT" --task "$TASK"
```

同一波次有多个 accepted/pending Task 时优先整波执行：

```sh
python3 sdd-change/scripts/sdd.py integrate "$CHG" --root "$PROJECT" --wave --check
python3 sdd-change/scripts/sdd.py integrate "$CHG" --root "$PROJECT" --wave
```

集成状态与 wave 候选都不进入 Graph schema：前者由 `result_revision` 是否为当前 HEAD ancestor 实时推导，后者按 Graph 顺序从 accepted/pending Task 派生。`--wave --check` 在一个 detached worktree 中链式 merge 整个 wave，可在写 Main 前发现兄弟 Task 之间的真实冲突。下游 `prepare` 同时要求依赖 accepted 且该精确 revision 已进入 baseline，因此实际执行按 wave 推进。

## 3. 普通返工

契约不变时，暂停相关 Worker 并一次汇总反馈：

```sh
python3 sdd-change/scripts/task_graph.py --root "$PROJECT" --change "$CHG" --task "$TASK" --action rework --reason "合并反馈" --workers-stopped
```

rework 可重开 accepted，受影响任务及下游回 planned；旧状态、版本和摘要进 history，代码和工作区保留。按依赖顺序重新 approve / prepare；复用工作区须先正常集成上游、保存实现改动，再执行：

```sh
python3 sdd-do/scripts/prepare_workspace.py "$CHG" "$TASK" --root "$PROJECT" --reuse --base "$WORKTREE_HEAD"
```

不自动 reset / rebase，不丢弃未提交实现。每次派发增加 attempt，旧报告不能顶替；优先恢复原 Worker。

## 4. 契约变化与模式批准

授权遵循 [流程策略](../../sdd-init/references/workflow-policy.md)：进入 SDD 无额外模式审批；改变已冻结契约仍必须单独取得用户确认。

冻结契约需要变化时，先停止、上报变化与影响、等待用户明确确认；确认后才修订并执行：

```sh
python3 sdd-change/scripts/task_graph.py --root "$PROJECT" --change "$CHG" --task "$TASK" --action replan --reason "已确认的契约变化" --user-confirmed --workers-stopped
```

replan 撤销目标、摘要漂移任务及其下游的旧验收，保留历史；之后重新 approve / prepare / 验证。契约未变应 rework，不用 replan。approve/rework 遇漂移会拒绝，block 不能绕过用户确认。

## 5. 身份与证据边界

末尾唯一 `SDD:EVIDENCE:BEGIN/END` 只容纳验证结果与最终结论；未知 frontmatter、Change 规划、Design、Task 参与冻结。围栏中的示例不作边界，不能在证据区藏新要求。

文本摘要不识别语义等价，不在冻结后顺手润色。公共 Change 约束、Design 公共设计与整体停止条件属于所有 Task 的共享冻结；单个 AC / Dxxx 只冻结到显式引用它的 Task。Task 本地详细设计只存在于自己的 Contract，局部修改不会改变无关兄弟 Task 的摘要。`--user-confirmed` 和 `--workers-stopped` 是显式声明，不是身份认证或自动停止进程。

SDD Change 必须包含非空 Task Graph；纯文档小改动使用 Quick，不创建 Change。完整收口核对历次交付和集成 diff，而非仅最后一轮。

Path Contract 写在各 Task Design 中，只防当前 Worker 越界；兄弟 Task 的 allow 可重叠。Main 用 `sdd.py integrate` 集成 accepted result：单 Task 用 `--task`，同一 accepted/pending wave 优先先跑 `--wave --check` 再 `--wave`。脚本保护 result ancestry 与 Main 权威 Change 工件；普通代码冲突由 Main 处理，复杂语义冲突可回派原 Worker。Worker 阶段只跑定向验证；全部 Task 最终集成并由 Architect 同步 Current Truth 后，Main 统一跑全量并要求全绿。
