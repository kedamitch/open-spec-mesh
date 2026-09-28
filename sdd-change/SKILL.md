---
name: sdd-change
description: 在 SDD 规划上下文中形成 Change、完整 Delta Design、Task Graph 与 Task 局部详细设计；Quick 不使用。
---
# 变更准备

**输入**：原始需求、Current Truth、范围和约束。只在 mode=sdd 的规划工作中使用。

## 固定工件

所有新 Change 固定使用：

```text
CHG-.../
├── C01-change.md
├── C02-design.md
└── C03-tasks/
    ├── C03-task-graph.json
    └── C03-xx-<task>/
        ├── C03-xx-01-task.md
        └── C03-xx-02-delivery.md
```

编号含义固定。旧 Change 结构不作为合法输入，也不做兼容分支。

## 规划流程

1. 按 [Change 模板](references/change-template.md) 写人类可 Review 的需求：背景/问题、目标、范围、不做事项、Requirements、AC、约束和影响范围。
2. 完成 [Design](references/design-template.md)。Design 必须读取受影响 Current Truth，并按 **Current → Delta → Target** 写清：
   - 产品模块 / 功能 / 规则；
   - 接口 / 协议及兼容；
   - 领域模型 / 状态机 / 不变量；
   - 表 / 字段 / 索引 / 约束 / 数据迁移；
   - 应用职责 / 组件 / 依赖；
   - 总业务流程 / 主时序；
   - 跨 Task 的事务、一致性、幂等、并发、失败恢复。
   没有变化的维度也要明确写“无变化”。
3. Architect 使用 Node `open-spec-mesh new-task` 命令形成完整 Task Graph；Main 不二次拆分、改写或转译。Task 优先按业务模块/完整业务结果拆分，不为避免文件冲突继续细拆。
4. Design 的「Task 关系与设计落点」同时给人类可读 Mermaid + Task 表，并与机器 Graph 一致。低/中度公共路径重叠允许并行 worktree；高度重合或存在真实语义先后时才用 depends_on 串行。
5. 每个 Task Contract 是可实施的小设计：范围、Path Contract、代码结构、Task 流程、核心对象职责、本地 API/Domain/Schema 变化、失败边界、定向测试、AC、预期输出。Path Contract 只限制当前 Task 的合法写入，不要求与兄弟 Task 互斥。
6. **完整设计前置**：整张 Graph、Design 和全部 Task Contract 一次性交付，可先 Review 再实现。

## 完成

只有全部规划工件可执行时才结束。若 Design / Task / Graph 不一致或仍有必需占位，继续在当前 Architect 上下文修正，不推进 running / submitted / accepted。

需要调查时只按 Role Prompt 委派 Explorer / Librarian。底层冻结和恢复规则见 [Task 协议](references/task-graph.md)，完整写作格式见 [文档契约](../sdd-init/references/document-contract.md)。
