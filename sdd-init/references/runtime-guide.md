# 日常工具指南

Quick 默认由当前 Agent 连续完成；SDD 分阶段留文档、由人确认。单任务或串行不启动 Worker/worktree，只有并行实现才隔离。新代理命名 role_desc，例如 explorer_module_flow。

- open-spec-mesh init-project / migrate-project：初始化或保全迁移文档。
- new-change：仅需求；ensure-design：显式设计；new-task：宏观 Task 和人可读计划。
- validate-docs：辅助建议，不决定阶段权限。
- new-research / new-adr / new-release / check-release：按授权写作与检查。
- observe / diagnose：只读证据，不自动调度。
- install：安装包受管内容，保全用户配置。

旧 sdd / task-graph / prepare-workspace / record-delivery / record-acceptance / run-leaf / check-change / close-change / run-validation 已退出。验证运行项目真实命令，交付与归档由当前 Agent 根据用户确认处理。

## SDD 技能使用引导

选择 SDD 模式后，Main 会说明当前阶段、给出可直接使用的技能调用示例，并在阶段完成时提示下一步；不会因为技能执行成功自动推进。

| 阶段或需要 | 技能 | 示例 |
|---|---|---|
| 按需初始化文档骨架 | `$sdd-init` | `$sdd-init 为当前项目建立文档骨架` |
| 需求 | `$sdd-req` | `$sdd-req 为这个需求创建或完善 Change` |
| 整体设计 | `$sdd-design` | `$sdd-design 需求已确认，编写整体设计` |
| 执行计划：任务拆分与任务设计 | `$sdd-plan` | `$sdd-plan 整体设计已确认，编写执行计划，包含任务拆分和任务设计` |
| 实现与验证 | `$sdd-do` | `$sdd-do 执行计划已确认，按计划串行实现并验证` |
| 交付与确认后归档 | `$sdd-close` | `$sdd-close 汇总实现结果和验证，先供我确认` |

已有文档骨架无需重复初始化。旧结构迁移用 `$sdd-migrate`；持久化研究/长期 ADR 按需用 `$sdd-research`；执行诊断仅在用户要求时用 `$sdd-diagnose`；版本发布材料用 `$sdd-release`，真实上传需要明确发布意图及本次目标版本，自然语言同样有效。自然语言授权也有效，调用技能不等于确认所有后续阶段。若技能未安装或当前会话不可用，Main 应如实说明并引导安装或加载。

原 `$sdd-change` 已拆分，需求技能现名为 `$sdd-req`；`sdd-change` 与旧名 `sdd-requirements` 均不再作为受管技能安装，旧 `sdd-change/scripts/` 入口已删除。升级时，已登记的旧目录先保存到 `open-spec-mesh/retired-skills/` 下的私有 ZIP，再退出技能发现；归档包含本地修改，不自动清理。未登记的用户目录保留并提示，不按名称删除。

## 安装入口

目标公共版本 0.0.2：发布后使用 npm install -g open-spec-mesh@0.0.2 --registry=https://registry.npmjs.org/，随后 open-spec-mesh install --host codex --skip-tools；其他宿主替换 --host，指定目录用 --host-home。全局安装和宿主配置是两步，安装后新开会话。源码/tarball 后备、升级、卸载与排错见 README；当前发布状态以真实 registry 结果为准，不以 pack/dry-run 判断。

## 发布授权与本地短命令

明确的自然语言发布指令（如“发布 0.0.2”）会自动使用 `$sdd-release` 并授权该版本的 npm 上传；仅准备材料时不上传。osm 无参数等价 Codex + skip-tools 安装，osm --dry-run 只预览；完整子命令保留。0.0.2 包含短入口，实际发布状态以 registry 结果为准。
