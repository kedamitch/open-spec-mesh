---
name: sdd-research
description: 在授权范围沉淀可复用证据或长期 ADR；普通调查不强制落盘，也不因调查本身进入 SDD。
---
# 研究与长期决策

普通事实核对直接返回调用者。只有需要跨 Change 复用时才采用本技能；资料数量本身不触发额外流程。

## 证据任务

只读调查上下文只负责返回结论、来源和限制，不运行建文档脚本、不采纳设计决策。完成后返回调用者，不自动启动 Change、实现或其他角色。

## 持久化研究

只有获得相应写入职责的规划上下文才使用 `node scripts/new_research.js <title> --root <project>` 按 [研究模板](references/research-template.md) 保存可复用结论；长期关键选择用 `node scripts/new_adr.js <title> --root <project>` 按 [ADR 模板](references/adr-template.md) 记录。局部决策留 Design，不为每个 D001 新建 ADR。

本 Skill 不定义谁可以委派谁；调用者只按自己的 Role Prompt 使用它。
