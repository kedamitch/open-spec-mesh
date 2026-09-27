# 技术架构总览

## 系统范围

本仓库由 Codex 配置、Agent Role、Markdown Skill、本地 Python CLI、安装器和离线诊断工具组成。没有常驻业务服务或业务数据库。

## 技术 / 应用架构

- [System Context](T05-diagrams/T05-01-system-context.md)
- [应用架构](T05-diagrams/T05-02-application-architecture.md)

## 应用与职责

| 应用 / 模块 | 核心职责 | 上游 | 下游 / 依赖 | 代码入口 |
| --- | --- | --- | --- | --- |
| Codex 配置与 Roles | 角色能力、模型与有限委派 | 用户配置 | Skills / Provider | `config.toml`, `agents/` |
| SDD Skills | 规划、执行、收口、发布、调研 | Codex | Python CLI / docs | `sdd-*/` |
| SDD Python CLI | 编号、Graph、冻结、派发、Delivery、最终验证 receipt、归档 | Skills / Main / Worker | Git / Markdown / JSON | `sdd-change/scripts/`, `sdd-do/scripts/`, `sdd-close/scripts/` |
| Installer | 安装受管工具和配置 | shell | CODEX_HOME / npm | `scripts/install.py` |
| Observation CLI | 只读采集与确定性诊断 | rollout / SDD artifacts | SQLite / bundle | `sdd-do/scripts/observation/` |

## 核心技术栈

| Layer | Technology | Purpose |
| --- | --- | --- |
| Runtime | Python 3.11+ | SDD CLI、安装和诊断 |
| State / Documents | Markdown + JSON | 人类文档与 Task Graph 状态 |
| Version Identity | Git / worktree | baseline、revision、diff、依赖集成 |
| Configuration | TOML | Codex / Agent 配置 |
| Diagrams | Mermaid | 架构、流程、状态可视化 |

## 应用交互

[主流程时序](T05-diagrams/T05-03-main-sequence.md) 描述 Quick / SDD 端到端路径。SDD runtime 只判断机械状态和允许动作，Main 保留语义路由与验收判断。

## 外部依赖

| 依赖 | 用途 | 协议 / 边界 |
| --- | --- | --- |
| Codex 客户端 | Skill / Role 执行宿主 | 外部 |
| 模型 Provider | 推理 | 用户配置 |
| Git | revision / diff / worktree | 本地命令 |
| npm 工具 | CodeGraph / Context7 / Tavily | 安装时按需 |

## 公共机制

- **鉴权**：本地 CLI 不实现身份认证；Provider / Connector 凭据由宿主环境管理。
- **事务**：文件更新使用锁与原子替换；Git revision 作为实现身份；最终验证 receipt 绑定指定 revision 和版本化验证入口。
- **缓存**：核心 SDD 状态无共享缓存；可选 System One 有独立短时缓存。
- **消息**：无常驻消息总线。
- **错误处理**：校验失败在状态写入前返回；冻结契约漂移必须 replan。
- **配置**：TOML + 环境变量；秘密不写入仓库。

## 技术基线入口

- [API / CLI](T02-api.md)
- [Database / Local Stores](T03-database.md)
- [Domain Model](T04-domain-model.md)
- [主流程时序](T05-diagrams/T05-03-main-sequence.md)
- [运维](../04-operations/O01-operations-overview.md)
