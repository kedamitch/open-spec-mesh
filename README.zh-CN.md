<div align="center">

# Open Spec Mesh

**Spec-Driven Multi-Agent Development**

规格定义事实，Agent 负责理解与执行，脚本负责确定性约束。

[English](README.md) · [简体中文](README.zh-CN.md)

[![SDD](https://img.shields.io/badge/SDD-Spec--Driven-111827?style=flat-square)](docs/index.md)
[![Multi-Agent](https://img.shields.io/badge/Multi--Agent-Mesh-4F46E5?style=flat-square)](AGENTS.md)
[![Node.js](https://img.shields.io/badge/Node.js-24.21%2B-339933?style=flat-square)](package.json)

</div>

---

Open Spec Mesh 是一套面向多 Agent 软件开发的轻量 **Spec-Driven Development** 框架，并原生适配 **Codex、OpenCode、Claude Code** 三种宿主。

模型专注于真正需要语义能力的部分：理解、设计、实现、评审；脚本负责生命周期、Task Contract、状态、证据、验证与恢复。

## 为什么是 Open Spec Mesh？

| 原则 | 含义 |
| --- | --- |
| **Spec First** | Change、Design、Task Contract 是持久事实源。 |
| **Agent Mesh** | Main、Architect、Worker、Reviewer、Explorer、Librarian 按职责协作，不组成僵硬流水线。 |
| **人类优先** | 文档首先服务 Review；机器状态保持小而明确。 |
| **确定性控制** | 状态流转、Contract 漂移、工作区边界、验证证据交给脚本。 |
| **默认轻量** | 简单工作保持 Quick；确实需要持久设计或独立执行时才进入 SDD。 |
| **证据优先** | Delivery、Acceptance、Close 都绑定真实 revision、测试与证据。 |

## 两种执行模式

<table>
<tr>
<td width="50%" valign="top">

### ⚡ Quick

适合 Main 可以连续完成的工作。

- 直接实现
- 测试与自审
- 缺证据时按需使用 Explorer / Librarian
- 不创建 Change / Task

</td>
<td width="50%" valign="top">

### 🕸️ SDD

适合需要持久设计或独立执行单元的工作。

- Architect 一次性完成完整规划
- Task Graph 表达依赖关系
- Worker 独立实现 Task
- Main 负责集成与最终验证

</td>
</tr>
</table>

## Agent Mesh

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/agent-mesh-dark.svg">
  <img src="assets/agent-mesh-light.svg" alt="Open Spec Mesh agent collaboration: Main coordinates Architect, Worker, Reviewer, Explorer and Librarian around spec-driven development." width="100%">
</picture>

**Main 负责协调，Architect 负责 SDD 规划，Worker 负责实现，脚本负责机械规则。**

## SDD 主流程

```text
Change
  ↓
Design
  ↓
Task Graph + Task Designs
  ↓
Freeze
  ↓
Worker Execution
  ↓
Delivery
  ↓
Integration Waves
  ↓
Current Truth Sync
  ↓
Full Validation
  ↓
Close / Release
```

Task Graph 只保存拓扑和运行状态；真正给人 Review 的设计内容保持在 Markdown 中。

## 快速开始

### 环境

- Python 3.11+
- Git
- Linux / macOS
- Codex、OpenCode 或 Claude Code 之一
- 可选研究工具需要 Node.js 20.18.1+ / npm

### 安装

Codex 保持默认兼容行为：

```bash
./install.sh --dry-run
./install.sh
```

显式安装到其他宿主：

```bash
./install.sh --host opencode
./install.sh --host claude
```

常用选项：

```bash
./install.sh --host <codex|opencode|claude> --host-home /path/to/runtime-home
./install.sh --skip-tools
./install.sh --include-project-docs
./install.sh --with-laya       # 仅 Codex host
./install.sh --without-laya
./install.sh --codex-home /path/to/runtime-home
```

安装器不会接管用户的 provider、model 或真实凭据。OpenCode 使用原生 Rules / Skills / Agent Markdown，并把同一组 canonical Role 同步到 Open Spec Mesh 自己的 config overlay 以兼容当前正式版运行时；Claude Code 使用原生 Rules / Skills / Agents 和独立 MCP overlay。

启动 Main：

```bash
# Codex：启动正常配置好的 Codex 会话。

# OpenCode
OPENCODE_CONFIG="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/open-spec-mesh.opencode.json" \
  opencode --agent main

# Claude Code
claude --agent main \
  --mcp-config "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/open-spec-mesh.mcp.json"
```

## 核心工作流

| 阶段 | 入口 | 职责 |
| --- | --- | --- |
| 规划 | `sdd-change` | Change、Design、Task Graph、全部 Task Design |
| 执行 | `sdd-do` | 工作区准备、Worker Delivery、观测 |
| 收口 | `sdd-close` | 验收、revision-bound validation、归档 |
| 初始化 | `sdd-init` | 标准项目结构 |
| 迁移 | `sdd-migrate` | 旧文档结构安全迁移 |
| 调研 | `sdd-research` | 证据调查 |
| 诊断 | `sdd-diagnose` | 纯脚本诊断数据包 |
| 发布 | `sdd-release` | 发布检查与记录 |

## 文档契约

```text
C01 Change
├── 目标 / 范围 / 验收标准
│
C02 Design
├── Current Truth Delta
├── 架构 / API / 领域 / Schema
├── 主流程 / 时序
└── Task 协作关系
│
C03 Tasks
├── Task Graph
└── Task Design + Delivery
```

Task 优先按完整业务能力或独立可验收结果拆分，不因为文件有重叠就机械拆细。

## 验证

统一的本地验证入口：

```bash
node scripts/sdd_validate.js --profile core
```

Pull Request 运行核心验证；main 与手工 full run 再增加 Mermaid、Docker、Codex/OpenCode/Claude Runtime、Research Tools、Node MCP 与明确的 GPU factory Python lane。宿主 Runtime smoke 使用真实 CLI 解析配置，但不调用模型。

## 可选语义判断层

Open Spec Mesh 可以选择启用 **System One** bridge 来执行重复语义判断。

- 默认关闭
- Laya 是默认可选 provider
- TypeSafe Jev 必须显式启用
- 结果只是建议
- 不扩权、不审批 Contract、不替代验收

完整协议与模板见 [typesafe-laya](typesafe-laya/SKILL.md)。

## 从哪里开始读

| 主题 | 入口 |
| --- | --- |
| 整体流程 | [治理与 SDD Workflow](docs/01-governance/G01-sdd-workflow.md) |
| 产品模型 | [SDD Runtime 模块](docs/02-product/P02-modules/P02-01-sdd-runtime.md) |
| 技术架构 | [Architecture Overview](docs/03-architecture/T01-architecture-overview.md) |
| 日常运行 | [Runtime Guide](sdd-init/references/runtime-guide.md) |
| 文档规范 | [Document Contract](sdd-init/references/document-contract.md) |
| Agent 职责 | [AGENTS.md](AGENTS.md) |
| 运维 | [Local Toolkit](docs/04-operations/O02-applications/O02-01-local-toolkit.md) |
| 完整项目资料 | [docs/index.md](docs/index.md) |

---

<div align="center">

**Open Spec Mesh**

*Spec-Driven Multi-Agent Development*

</div>
