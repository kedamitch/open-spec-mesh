# 执行行为诊断

## 定位

回答“为什么没委派 Explorer、为什么没按 SDD 执行、应该修改哪层规则”。使用已有执行证据和确定性规则，**不增加诊断模型调用、不追加 Agent 埋点提示词**。

## 能力与边界

日常入口为 `$sdd-diagnose`：自动定位当前项目，选取最近 7 天至多 20 个根 turn，关联显式委派的子会话，生成私有 ZIP。无需填写会话路径、turn 或多条命令；包包含摘要、逐片段 MD/JSON、当前规则指纹和覆盖/校验清单。

诊断包复用既有 observation 内核，不创建观察数据库、不修改研发状态、不自动上传。无日志与部分覆盖明确显示；不会将多个片段猜成同一需求。原始 observe CLI 仍支持精确采集、操作者期望、显式分组和 SQLite 版本汇总。

诊断区分规则限制、实际失败、执行偏差候选和证据不足；每项附源定位和固定最小建议。不从思维链解释动机、不自动改提示词。当前文件指纹不证明历史加载，唤起技能本身仍有正常对话开销。单 Task integration 与 wave integration 均按实际 CLI 调用记录；`integrate --wave` / `--wave --check` 各自只形成一个 change 级事实，不把内部循环虚构成多个 Task 事件。

当前路由允许 Quick / SDD 都使用 Explorer / Librarian；Quick 不允许 Architect / Worker / Reviewer。SDD 的 Worker 必须在 Architect Task Graph 就绪后才可派发。诊断用于揭示实际执行与这些规则的偏差，不自动修改规则或授权边界。

## 使用入口

[一键诊断技能](../../../sdd-diagnose/SKILL.md) · [包格式与范围](../../../sdd-diagnose/references/usage.md) · [原始 CLI 与诊断规则](../../../sdd-do/references/observation.md)。

新增的 sdd-diagnose 是按需打包入口，不加入研发主流程；现有安装器一并部署。包默认位于 CODEX_HOME/sdd-observe/bundles/，权限 0600、项目外、原子发布、不覆盖旧文件；原始对话、命令、源码和配置正文不复制进包。
