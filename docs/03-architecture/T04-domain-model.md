# 领域模型与状态机

## 对象与关系

Change 固定包含 C01 Change、C02 Design 和 C03 Task Graph / Task Design。Task 包含依赖、冻结契约、baseline、workspace、attempt、当前 delivery 和 history。Current Truth 保存验收后的系统事实。

## 状态机与迁移

[任务状态机](T05-diagrams/T05-04-domain-state.md)。

| 当前状态 | 事件与条件 | 目标状态 | 动作/失败处理 |
| --- | --- | --- | --- |
| planned | approve，真实正文、已完成字段、唯一非空 AC、有效 Task 引用 | planned | 完整性失败不写摘要；通过后记录摘要，不启动执行 |
| planned | prepare，契约完整性复查通过，依赖已验收且在基线 | running | 失败不创建工作区或变更 attempt；通过才派发 |
| running | 当前交付通过摘要、版本、文件表和 attempt 校验 | submitted | 记录结果与报告摘要 |
| submitted | Main 验证 AC 与真实证据 | accepted | 进入集成候选；只有精确 result revision 已进入下游 baseline 才可派发依赖 Task |
| 任意受影响状态 | rework/replan；活动 Worker 已明确停止 | planned | 撤销当前验收，传播到下游，保留历史和工作区 |
| 任意受影响状态 | block，明确原因 | blocked | 阻断依赖并保留诊断 |

## 不变量

submitted 不解锁下游。accepted 与 integrated 是两个事实：accepted 属于 Task Graph；integrated 不新增状态，只由 `result_revision` 是否为当前 HEAD ancestor 推导。accepted 可显式重新打开但旧验收只在 history；不能成为新契约验收。每次恢复创建新 attempt，旧报告拒收。
replan 不自动停止 Worker 或回滚代码；Main 先停止后执行，并使用 --workers-stopped 确认。该参数是操作者声明，不是进程隔离。

冻结契约实质变化使用 replan，必须先取得用户明确确认并以 --user-confirmed 留审计标记；普通 rework 不能接受摘要漂移。用户确认前只允许保留证据和停止相关工作，不能修改契约或启动新假设的实现。

## 观测对象

Execution Slice 是显式 root thread/turn 的证据窗口；SDD Task/attempt 是研发单元；多个 Slice 只有经操作者 group 才成为同一需求视图。三者不互相等同。Session 保留原始父线程和已观测角色/模型；委派调用与子线程成功创建分开。

Finding 是固定规则推导的观测、失败、候选或 unknown，不是模型动机或授权。规则文件指纹是事后清单；只有原生注入记录可提供当轮规则证据。元数据存在、文件读取、Skill 执行和业务验收四者不等价。

采集 → 归一化 → 诊断 → 原子保存为可重建旁路，不加入 Task 状态机，不改变已有审批门；重复采集不增加样本，来源不完整时不得据缺席认定违规。
