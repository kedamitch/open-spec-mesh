---
name: sdd-close
description: SDD 模式的交付阶段入口；汇总真实结果、引导人工确认、同步实际 Current Truth，并在最终确认后归档。
---
# 人工交付、实际 Current Truth 同步与用户确认后的文档归档。

当前 Agent 汇总真实实现结果和适用全量验证，交用户确认实现阶段。之后整理最终交付材料并同步实际受影响 Current Truth；用户最终验收后才移动 Change 到已完成目录并更新导航。

不强制启动 Architect，不要求 validation receipt、摘要或 Graph accepted 状态。格式检查只辅助，真实失败不能写通过；实质剩余问题由用户决定并记录。归档不等于发布。保全历史和用户工作区，脏 worktree 不强删。

## 阶段引导

明确区分实现结果确认与最终交付确认，并提示用户当前需要确认哪一项。若实现仍需修复，推荐 `$sdd-do` 在原授权范围继续处理，不伪造完成。只有用户最终验收后才归档；用户要求发布或发布材料时使用 `$sdd-release`；明确的自然语言发布指令与本次目标版本即可授权上传，仅准备材料时不上传。

写作参考：sdd-init/references/document-contract.md。
