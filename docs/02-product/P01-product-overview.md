# 产品总览

## 定位与用户

Open Spec Mesh 面向使用 Codex、OpenCode、Claude Code 的开发者，提供角色、Skills 和 Node 辅助工具，降低重复调查和文档成本，不是自动审批或常驻调度服务。

## 核心场景

Quick 当前 Agent 连续实现；SDD 按需求、整体设计、执行计划（任务拆分与任务设计）、实现、交付逐阶段留档并由人确认。单任务/串行不另起 Worker，明确并行时隔离 worktree。陌生事实优先只读调查，已知单点直接处理。

## 模块

- 人工流程与辅助 CLI：[流程工具](P02-modules/P02-01-sdd-runtime.md)。
- 本地角色与宿主语义：[角色路由](P02-modules/P02-02-agent-routing.md)。
- 受管安装、文档脚手架、只读观测/诊断、默认关闭的 System One、发布材料等能力保留；旧自动生命周期退出。

## 跨模块规则

新代理命名 role_desc，配置角色 ID 不变；宏观业务与安全边界约束结果，必要文件和局部细节自主处理。工具通过不替代人工确认，历史和用户工作区保全；真实测试和安全保护不能降级。用户已确认退出自托管 GPU 服务，当前第一方实现、测试和自动化仅使用 Node.js；System One 仅连接外部推理服务。

[产品架构](P03-diagrams/P03-01-product-architecture.md) · [用户流程](P03-diagrams/P03-02-main-user-flow.md)。
