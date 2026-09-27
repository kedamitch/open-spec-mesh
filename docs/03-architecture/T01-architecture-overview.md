# 技术架构总览

## 系统范围

本仓库由宿主 Adapter、Agent Role、Markdown Skill、本地 Python CLI、安装器和离线诊断工具组成。没有常驻业务服务或业务数据库。Codex、OpenCode、Claude Code 共用同一 SDD Core。

## 技术 / 应用架构

- [System Context](T05-diagrams/T05-01-system-context.md)
- [应用架构](T05-diagrams/T05-02-application-architecture.md)

## 应用与职责

| 应用 / 模块 | 核心职责 | 上游 | 下游 / 依赖 | 代码入口 |
| --- | --- | --- | --- | --- |
| Host Adapter | canonical Role/Skill → native layout/permission/config | canonical rules | 三宿主 | `scripts/host_adapter.py` |
| SDD Skills | 规划、执行、收口、发布、调研 | Host Agent | Python CLI / docs | `sdd-*/` |
| SDD Python CLI | Graph、冻结、派发、Delivery、integration、validation、archive | Main / Worker | Git / Markdown / JSON | `sdd-change/scripts/`, `sdd-do/scripts/`, `sdd-close/scripts/` |
| Installer | 三宿主受管安装与工具 overlay | shell | Host config home / npm | `scripts/install.py` |
| Observation CLI | 只读采集与确定性诊断 | host evidence / SDD artifacts | SQLite / bundle | `sdd-do/scripts/observation/` |

## 核心技术栈

| Layer | Technology | Purpose |
| --- | --- | --- |
| Runtime | Python 3.11+ | SDD CLI、Adapter、安装、诊断 |
| State / Documents | Markdown + JSON | 人类文档与 Task Graph |
| Version Identity | Git / worktree | baseline、revision、diff、integration |
| Host Config | TOML / JSON / Markdown frontmatter | Codex / OpenCode / Claude native config |
| Diagrams | Mermaid | 架构、流程、状态 |

## Host Adapter 不变量

- canonical Skill/Role 语义单一来源，不复制三套流程。
- Codex 保持现有 model/effort；OpenCode/Claude 继承用户模型。
- SDD worktree 是唯一 Task Git 隔离；宿主 worktree 不参与 baseline identity。
- 非 Codex 用户主配置不由 Open Spec Mesh 重写。
- 未支持的宿主私有观测能力明确 partial/unsupported。

## 外部依赖

| 依赖 | 用途 | 边界 |
| --- | --- | --- |
| Codex / OpenCode / Claude Code | Agent/Skill/session 宿主 | 外部 |
| 模型 Provider | 推理 | 用户配置 |
| Git | SDD revision/worktree | 本地命令 |
| npm 工具 | Research tools / runtime CI | 安装时按需 |

## 技术基线入口

- [API / CLI](T02-api.md)
- [Database / Local Stores](T03-database.md)
- [Domain Model](T04-domain-model.md)
- [主流程时序](T05-diagrams/T05-03-main-sequence.md)
- [运维](../04-operations/O01-operations-overview.md)
