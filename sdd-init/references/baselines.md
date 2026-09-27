# 文档基线

一级目录固定为 `01-governance` 至 `09-delivery`，子项前缀为 G/P/T/O/C/ADR/R/Q/D。文件与目录共享同级编号；`index.md` 不编号，只做导航。

## Current Truth

- `02-product`：产品定位、产品架构、模块、功能、用户流程和业务规则。
- `03-architecture`：应用架构、API、完整 Schema、领域模型、状态机和主时序。
- `04-operations`：部署、配置、监控、逐应用 Docker / .env / 一行部署与回滚。

初始化只建立待核实骨架；后续只能按真实系统补充。

## Change 固定编号

所有 Change 只允许以下结构：

```text
CHG-YYYYMMDD-<name>/
├── index.md
├── C01-change.md
├── C02-design.md
└── C03-tasks/
    ├── index.md
    ├── C03-task-graph.json
    └── C03-xx-<task>/
        ├── index.md
        ├── C03-xx-01-task.md
        └── C03-xx-02-delivery.md
```

编号语义固定，不按创建顺序重新解释。旧 Change 结构不是合法输入，不保留兼容读取。

`C03-task-graph.json` 是机器状态文件；其余正式工件为 Markdown。Dockerfile、`.env.example`、应用源码放在 docs 外。

完整内容准则见 [文档契约](document-contract.md)，模式与职责见 [流程策略](workflow-policy.md)，运行命令见 [Task 协议](../../sdd-change/references/task-graph.md)。
