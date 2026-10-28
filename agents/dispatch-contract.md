# 派发契约 (Dispatch Contract)

固定 Role Prompt + 任务派发数据包 (Dispatch Packet)。公共派发层不维护全局复杂的 Routing Graph；调用方仅按各角色声明的委派边界派发，不向子 Agent 注入无关全局角色拓扑。

## 派发原则

只在净收益明确时委派：压缩大量调查材料、真实独立并行或明确专业风险。
- **已知上下文充分、交接成本接近直接执行时自行处理**；
- **实现任务分流准则**：
  - **并行任务**：具备独立模块边界且可并行的多任务，按 Task Brief 直接派发 Worker 并行实现与编写测试；
  - **纯串行任务**：严禁主 Agent 私自就地闭环，必须在计划阶段完成时通过交互式问询询问用户决策（就地串行实现 vs 逐个派发 Worker 串行执行），由用户拍板；
- 派发命名：新 Agent 标题使用 `role_desc`（如 `explorer_module_flow`、`worker_document_tools`、`architect_c02_design`）。

## 任务工单派发要素 (Task Brief 4 要素)

Main 向 Worker 派发任务时，使用结构化轻量工单，覆盖以下 4 要素：
1. **Goal (交付目标)**：本次任务具体交付的业务能力与结果。
2. **Boundary (模块边界)**：允许读写的文件或目录范围；严格禁止越界修改。
3. **Contracts (公共契约)**：引用 C02 Design 中的公共 API 签名、数据 Schema 或外部输入。
4. **Acceptance Criteria (验收命令)**：明确的定向测试命令与预期全绿标准。

> **Worker 自治声明**：Worker 在其模块目录边界内享有完全实现自由，**无需输出详设文档或伪代码**；内部私有函数与重构由 Worker 自主闭环，代码与全绿单测即为终极规范。

## 架构设计派发要素 (Architect Brief)

Main 向 Architect 派发设计任务时，提供：
- 需求目标 (C01 Change) 与用户意图；
- 受影响模块与当前基线 (Current Truth T01-T05)；
- 明确要求 Architect 聚焦宏观公共契约（C02 Design），严禁插手 Worker 模块内部私有逻辑。

## 独立验收责任归属

- **日常验收由 Main 独立完成**：根据 Worker 出具的真实自动化测试日志与 Git Diff 摘要进行核验，取消独立 Reviewer 角色。
- 只有证据失效或不足时，Main 补跑定向验证；测试全绿且符合契约方可确认交付。

## 统一交付 5 元组 (Delivery 5-Tuple)

所有子 Agent 完成后，必须统一以标准化 5 元组向调用方返回：
- `status`：`completed` | `failed` | `blocked`
- `result`：核心交付成果概述（1-3 句）。
- `evidence`：真实执行证据（必须包含测试命令输出、验证日志或精准文件行号引用，严禁口头声明）。
- `artifacts`：新增或修改的文件路径清单。
- `blockers`：遇到的阻塞问题（仅在 status 不是 completed 时填写）。
