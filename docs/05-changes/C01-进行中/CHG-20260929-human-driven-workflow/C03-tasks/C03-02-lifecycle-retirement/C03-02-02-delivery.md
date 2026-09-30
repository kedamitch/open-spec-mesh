# C03-02｜退出自动生命周期：实施记录

> 2026-09-29，当前 Agent 串行实施；相关能力已实现并通过 Node 回归，待用户确认。

## 实际结果

删除自动状态写入、冻结/派发、leaf launcher、验收 receipt 和 wave 集成链及其公开命令：sdd、task-graph、prepare-workspace、record-delivery、record-acceptance、run-leaf、check-change、close-change、run-validation。调用旧命令明确失败并指向人工流程，不提供成功占位或另一条隐藏自动通道。

release 与文档辅助改用通用 Node 文档读取，不依赖 workflow 模块；完成目录与人工确认负责业务阶段，发布材料工具不代表部署。Graph schema 仅保留历史只读用途，不写新 Graph。

退出重复 Python 工具/自动流程实现和相应自动状态机测试；保留能力由 Node 回归覆盖。Docker fixture 改为 Node HTTP 服务，保留 env-file、字面量值、健康检查、非 root 和 secret-exclusion 场景。

## 验证与自审

CLI、文档、release 和历史 Graph 兼容 Node 回归通过；静态检查未发现 Node 调用 Python 回退或恢复 Task 路径授权。119 个 JS 文件语法检查通过。

已删除的自动冻结、attempt、receipt、accepted/wave 执行场景是用户明确要求退出的能力，不以删除保留能力或 skip 获得通过。旧 Graph/Delivery 数据、Git 和已有 Python sqlite baseline fixture 保留为历史证据，不执行 Python。

此前迁移 Change 的 23 个文件及两份原 lock 与实施前备份逐字节一致；未执行 stash/reset/rebase/commit，也未建立 worktree。

## 未完成项

75 个原 tracked Python 源文件中删除 72 个；保留的 3 个 GPU 文件及 GPU 专用 Python CI/依赖仍需 C03-05 决定。zero-Python audit 仍真实失败，未设豁免。本 Task 不声称整仓迁移完成。

## 2026-09-29 后续：GPU 退出已确认

本记录正文保留 GPU 授权前的实现结果、未决项及失败证据。用户后续已明确允许删除自托管 GPU，服务与专属 Python 测试/CI/依赖现已退出；最新核心完整验证 exit=0，9 项检查与 163 项 Node/Agent 回归通过，Python=0。最新事实见 [C03-05 实施结果](../C03-05-node-gpu-service/C03-05-03-delivery.md)。此前 core 失败不再是当前结果；扩展验证尚未全绿，不把核心通过当作最终人工验收。
