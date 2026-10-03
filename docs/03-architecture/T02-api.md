# 接口定义

## 公共约定

工具入口是 open-spec-mesh Node CLI、Skills 与宿主角色配置。非法参数、读写与安全错误非零退出；文档格式建议不决定阶段授权。

## 能力接口

| CLI | 用途 / 边界 |
| --- | --- |
| install | 三宿主显式安装，保全模型、凭据和未受管资产 |
| init-project / migrate-project | 初始化或字节保全旧文档，不创建审批状态 |
| new-document / new-research / new-adr | 写作、编号和导航 |
| new-change | 仅需求阶段工件 |
| ensure-design | 显式创建设计，不覆盖已有正文 |
| new-task | 宏观任务、Markdown 计划和导航，不生成 Graph 或空 Delivery |
| validate-docs | 格式/结构/链接诊断建议，不证明语义或批准下一阶段 |
| new-release / check-release | 已完成 Change 的发布材料及建议，不能证明真实部署 |
| observe / diagnose | 只读证据与私有离线 ZIP；当前模式为 quick / sdd；旧 semi-auto 标签作为兼容别名可读 |
| inspect-host | 只读宿主受管文件/default核验，活动会话unknown；json/md输出 |
| evaluate-collaboration | 六场景规范化动作检查，默认JSON；检查失败exit 1，incomplete可exit 0，必须读status；不是人工或语义验收 |
| systemone | Node MCP 四工具与显式 HTTP 传输；默认关闭 |
| recover-lock | 核对资源锁 owner 且明确停止写进程后恢复，不恢复生命周期 |

旧 sdd、task-graph、prepare-workspace、record-delivery、record-acceptance、run-leaf、check-change、close-change、run-validation 入口已删除。Git 集成与验证直接使用实际工具和命令。

角色建议不再依赖 task_graph_ready；单任务/串行由当前 Agent 执行，只有明确并行实现授权时才建议 Worker。旧 sdd 输入作为人工模式的兼容标签，不恢复旧状态机。

## 外部推理服务边界

自托管 GPU 服务和专属 Python 部署已按用户确认删除。System One 仅保留 Node.js HTTP/MCP 客户端及现有四工具；Laya 对接操作员配置的外部兼容合批 API，Jev 对接外部 TypeSafe API。端点配置、认证、超时、结果校验与 fallback 属客户端职责；推理模型、硬件和服务端批处理属于外部提供方，不声称仓库实现了 Node GPU 引擎。

## 2026-10-01 协作入口补充

evaluate-collaboration支持--format json|md（报告/列表），默认json；--fail-on-incomplete显式让不完整exit3，失败1、参数错误2，默认行为保留。inspect-host增加subagent_defaults模型/effort及旧gpt-5.6-luna默认警告；仍不证明活动会话。install的--migrate-legacy-agent-defaults仅显式将旧默认gpt-5.6-luna迁至包默认，不改其他默认、effort或Main，仅Codex可用。

可选scripts/verify_codex_live.js --run --output PRIVATE_DIR使用现有认证进行真实双臂Quick验证，可能计费；不加入core/full或默认安装，不复制原始对话/认证，不覆盖model/effort；同目标验收、真实派发与原会话增量、用量范围分别报告。
