# 人工推动的两模式研发流程

## Purpose

定义快速模式与人工逐阶段确认的半自动模式。原人工流程需求与设计已确认；新增完整 Node.js 迁移与 Python 退出需求，用户已授权直接串行实施；用户现已明确授权退出自托管 GPU 服务；代码与依赖已清理，追加 Node 22、npm 全局安装与真实 Home 清理已实施；Node 22.0.0 / 当前 Node 24.19.0 的核心 9 项检查及 164 项 Node/Agent 回归通过。外部工具扩展验证和最终人工验收分开记录，未归档。

## Documents

- [C01 Change：原需求与新增 Node.js 范围](C01-change.md)
- [C02 Design：整体设计、Node.js 范围与已确认 GPU 退出方案](C02-design.md)
- [C03 Tasks：任务计划、宏观设计与实施记录](C03-tasks/index.md)

## Navigation

- [返回进行中变更](../index.md)
