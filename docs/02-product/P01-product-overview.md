# 产品总览

## 定位与用户

Open Spec Mesh 面向使用 Codex、OpenCode、Claude Code 的开发者，提供角色、Skills 和 Node 辅助工具，降低重复调查和文档成本，不是自动审批或常驻调度服务。

## 核心场景

Quick 当前 Agent 连续实现；SDD 按需求、整体设计、执行计划（任务拆分与任务设计）、实现、交付逐阶段留档并由人确认。单任务/串行不另起 Worker，明确并行时隔离 worktree。委派先判断净收益：压缩大量调查、真实并行或专业风险值得交接时才使用只读角色；已知单点或交接成本接近直接执行时由当前 Agent 处理。

## 模块

- 人工流程与辅助 CLI：[流程工具](P02-modules/P02-01-sdd-runtime.md)。
- 本地角色与宿主语义：[角色路由](P02-modules/P02-02-agent-routing.md)。
- 受管安装、文档脚手架、只读观测/诊断、默认关闭的 System One、发布材料等能力保留；旧自动生命周期退出。

## 跨模块规则

新代理命名 role_desc，配置角色 ID 不变；宏观业务与安全边界约束结果，必要文件和局部细节自主处理。工具通过不替代人工确认，历史和用户工作区保全；真实测试和安全保护不能降级。用户已确认退出自托管 GPU 服务，当前第一方实现、测试和自动化仅使用 Node.js；System One 仅连接外部推理服务。

[产品架构](P03-diagrams/P03-01-product-architecture.md) · [用户流程](P03-diagrams/P03-02-main-user-flow.md)。

## 协作效率能力

保留完整 docs/01–09、Change、Task 和 Delivery；共享事实按所属文档维护，简单任务短写但保留可执行验收。按需提供只读宿主文件核验、规范化动作评估及去重用量；不把配置文件一致或夹具通过写成活动模型已生效、语义验收或实际节省。实现边界见 [协作优化交付](../05-changes/C02-已完成/CHG-20260930-collaboration-efficiency/C04-delivery.md)。

## 默认模式边界

新目标默认Quick，连续执行/端到端/加载技能不自动进入SDD；Quick不建Change/Task/Delivery链，按实际影响维护既有事实。明确SDD时仍完整保留01–09与正式工件，单任务短写。人工确认状态与实际源码现状分开记录。
