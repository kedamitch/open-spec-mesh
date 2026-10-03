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

## 协作减重与按需核验（当前源码）

现有 docs/01–09、C01/C02/C03、独立 Task/Delivery 完整保留，公共事实引用复用，简单任务短写。委派先判断净收益，同一执行者完成闭环；设计区分约束/方案/假设，关键未知先最小验证，内部实现变化不重开阶段。边界例子见 [协作指南](collaboration-guide.md)。

- `inspect-host [--host HOST] [--home DIR] [--format md|json]`：只核对安装文件的非敏感模型字段，区分包基线与用户覆盖；不读取 auth 文件、不调用 provider、不改配置。当前活动会话始终 unknown，文件一致不证明旧 session 已重载。
- `evaluate-collaboration --report NORMALIZED_JSON --scenario ID`：只检查已有归一化动作，`--list` 列出六种场景；不调用模型、不路由工作、不批准阶段。incomplete 不是通过全部行为。
- 人工流程的旧 Graph 首轮通过/返工指标不适用；`usage_observed` 是已知部分，`usage_total` 只在覆盖完整时存在。同 session/slice 去重，缺失/冲突不当作零；金额未知。
- 可选 `observe collect --rework-mark ID:assumption|handoff|integration` 保存部分人工证据，不从对话推断返工。效果对照见 [评估方案](collaboration-evaluation.md)。

维护者以 `sdd-init/references/workflow-policy.md` 为通用规则唯一来源，`npm run sync:workflow` 同步必要副本，`npm run check:workflow` 只检查；根 AGENTS 的 COMMON 标记外内容保全。安装器不使用根 AGENTS 全文。本节新增能力属于当前源码变更，不代表已发布的 0.0.2 或既有 Home 已升级。
