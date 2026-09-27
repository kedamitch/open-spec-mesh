---
integrated_revision: pending
product: pending
technology: pending
operations: pending
---
# 变更说明

> **目标**：让 Open Spec Mesh 在保留 Codex 兼容的同时，原生运行于 OpenCode 与 Claude Code，三种宿主共享同一 SDD Core、角色语义和 Task 状态机。

## 背景与问题

当前 SDD 文档、Task Graph 与生命周期脚本基本宿主无关，但安装、角色格式、Main/Agent 路由、leaf launcher、Skill 路径、MCP 接入和行为诊断仍明显绑定 Codex。仅复制文件不能形成可靠兼容：OpenCode 与 Claude Code 都有自己的 Agent、Skill、Session 和权限模型。

## 目标与范围

### 目标

- Codex / OpenCode / Claude Code 共用同一 Change / Design / Task / Delivery / Git runtime。
- 使用各宿主原生规则、Skill、Agent 与 session 能力，不复制三套 SDD 流程。
- 宿主差异由确定性 Adapter / Installer / Launcher 处理，不让 LLM 猜路径与权限。

### 本次包含

- Host Profile 与角色渲染。
- OpenCode / Claude Code 原生安装布局。
- 多宿主 leaf 执行与 session resume。
- Research MCP 的非破坏性附加配置。
- Observation / diagnose 的 host-aware 路径与能力声明。
- 真实 CLI smoke、回归和 Current Truth。

### 本次不做

- 不改变 Quick / SDD 模式与 Task 状态机。
- 不把 Codex 模型名硬映射到其他宿主。
- 不使用 Claude/OpenCode 自带临时 worktree 代替 SDD worktree。
- 不声称未解析的宿主私有 trace 已被完整观测。

## Requirements

- **R01**：宿主差异必须收敛在 adapter，核心 SDD 工件与状态机保持一套。
- **R02**：安装必须保留用户 provider/model/custom config 和凭据，不做破坏性接管。
- **R03**：角色委派边界在可用的宿主原生权限模型中落地，叶子角色不可继续委派。

## 行为与验收标准

### AC-01｜三宿主角色与 Skill 可发现

- **行为**：同一 canonical Role/Skill 可渲染为 Codex、OpenCode、Claude Code 的原生布局；Main/Architect/leaf 委派边界保持一致。
- **验证**：渲染单测 + OpenCode/Claude CLI 对安装产物的无模型 smoke。

### AC-02｜安装与升级不破坏用户配置

- **行为**：默认安装仍为 Codex；显式 `--host opencode|claude` 安装相应 runtime，可重复升级；不覆盖用户模型/provider/custom MCP。
- **验证**：临时 home 的新装、升级、dry-run、非受管文件保留和 host 路径回归。

### AC-03｜多宿主执行与恢复

- **行为**：leaf launcher 可在三宿主启动指定角色并以精确 session id 恢复；工作目录始终是 SDD prepare 返回的 workspace。
- **验证**：命令构造单测 + 真实 CLI help/version smoke；Codex 既有行为不回归。

### AC-04｜Research MCP 可附加但不接管用户配置

- **行为**：OpenCode/Claude 使用 package-owned MCP 配置与宿主合并机制；只引用环境变量名，不复制密钥；Codex 现有 MCP 行为保持。
- **验证**：配置渲染测试与 CLI 配置解析 smoke。

### AC-05｜诊断能力按宿主真实声明

- **行为**：观察数据目录与 host 身份不再依赖 CODEX_HOME；Codex 保持 native trace，OpenCode/Claude 对未支持私有事件明确标记 partial/unknown。
- **验证**：host-aware collect/report 回归，不把缺失事件记成成功或失败。

### AC-06｜三宿主持续验证

- **行为**：CI 独立验证 Codex、OpenCode、Claude Code 安装形状和 CLI 兼容；项目主验证继续全绿。
- **验证**：main full matrix 与新增 host runtime jobs 全部通过。

## 约束与待确认

### 已确定约束

- OpenCode 使用原生 `AGENTS.md`、`skills/`、`agents/*.md`。
- Claude Code 使用原生 `CLAUDE.md`、`skills/`、`agents/*.md`。
- 非 Codex 角色默认继承宿主当前模型；模型策略由用户/宿主配置决定。
- SDD prepare/worktree 是 Task baseline 与写入身份的唯一来源。

### 待确认

- 无。

## 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | Installation / Agent Routing / Observation / SDD Runtime |
| 应用 / 组件 | installer、host adapter、leaf launcher、observation、CI |
| Domain | 新增 HostProfile / HostCapability 派生概念 |
| Database | 无变化。 |
| API / Protocol | install CLI、leaf CLI、安装目录与 MCP package config |
| Operations | 新增 OpenCode / Claude Code runtime smoke |

<!-- SDD:EVIDENCE:BEGIN -->
## 验证结果

pending

## 最终结论

pending
<!-- SDD:EVIDENCE:END -->
