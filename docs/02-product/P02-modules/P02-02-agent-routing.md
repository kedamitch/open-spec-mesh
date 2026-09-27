# Agent Routing

## 模块定位

把 SDD 生命周期、角色选择和 Agent 工作方法分开：runtime 说明“机械上能做什么”，Main / Architect 判断“下一步该找谁”，角色 TOML 说明“被唤起后怎么把工作做好”。调查与执行分工保持正交。

## 局部路由原则

全局角色拓扑只属于系统实现与架构文档，不注入每个 Agent。运行时可以知道完整权限图以做硬过滤，但模型侧只看到自己的局部委派关系：

- Main：只知道自己可委派 Architect / Worker / Reviewer / Explorer / Librarian 及各自触发条件。
- Architect：只知道自己可委派 Explorer / Librarian。
- Worker / Reviewer / Explorer / Librarian：只知道自己不可继续委派；遇到超出职责的问题返回调用方，不猜测下一角色。
- 公共 `dispatch-contract.md` 只定义 Dispatch Packet，不再维护一份所有角色都能读取的 Routing Table。
- Laya/Jev 的 delegation 模板只看到当前角色和经过 runtime 过滤后的局部候选，不暴露隐藏角色。

## 路由分层

| 层 | 负责 | 示例 |
| --- | --- | --- |
| SDD State | Runtime | planning 是否完整、Task 是否 ready/running/submitted、依赖是否满足、Contract 是否漂移 |
| Deterministic Routing | Runtime + Main | incomplete planning → Architect；running Task → 原 Worker；Contract drift → 先用户确认 |
| Semantic Routing | Main / Architect | Quick 还是 SDD；本地未知还是外部未知；实现缺陷还是设计缺口 |
| Role Behavior | Agent TOML | Architect 如何设计、Worker 如何闭环实现、Reviewer 如何独立复审 |
| Dispatch Context | Dispatch Packet | 当前 goal、工件引用、baseline / attempt / workspace、依赖和增量约束 |

`sdd.py status` 只返回状态和 `allowed_actions`，不替 Main 做语义判断；`sdd.py prepare` 校验并冻结 Task 后生成 Worker Dispatch Packet，Main 不重新摘要 Task Contract。首次 Worker spawn 后用 `bind-session` 保存 session/thread，普通返工优先恢复原 Worker。

## 模式与角色

Quick 由 Main 连续完成，可按需委派 Explorer / Librarian；不调用 Architect、Worker、Reviewer。需要 Worker 执行、多个执行单元/并行执行，或需要先由独立 Planning Owner 形成持久化设计再实施时进入 SDD：Architect 直接负责必要 Design + Task Graph + Task Contract，Main 不二次拆解。

SDD Graph 就绪前优先 Architect；Graph 完整后 ready Task 才可派 Worker。用户明确要求独立复审时才可 Reviewer。内部实现、调用链、状态、数据或测试事实未知时用 Explorer；外部文档、协议、SDK、版本或供应商事实未知时用 Librarian。已有证据足够时当前角色直接完成，不为了分工而委派。

## 派发与恢复

原生 V2 用 `agent_type + fork_turns="none"` 选择角色；Role Prompt 长期固定，动态 Prompt 只追加 [派发契约](../../../agents/dispatch-contract.md) 定义的 Dispatch Packet，不复制完整历史。model / effort 由角色 TOML 固定。

同 Task 复用 Worker，同 SDD Change 复用 Architect；普通实现缺陷在原 Worker 内修复。Task 按业务模块拆分，depends_on 满足后允许 Path Contract 合理重叠的 Worker 使用独立 worktree 并行。高重合或真实语义先后由 Architect 串行化；Main 负责集成普通冲突，复杂冲突可回派原 Worker。Path Contract 是单 Task 越界保护，不新增兄弟 Task 文件锁 DSL。

用户确认门见 [流程策略](../../../sdd-init/references/workflow-policy.md)。V2 角色约束与独立进程 fallback 的边界见 [leaf-execution](../../../sdd-do/references/leaf-execution.md)；提示词、角色 sandbox、session 元数据和 fallback 都不等于操作系统级 ACL。
