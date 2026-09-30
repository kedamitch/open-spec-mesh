# C03-05｜退出自托管 GPU：实施结果

> 2026-09-29，用户明确授权“可以移除自托管GPU服务，只保留nodejs”，当前 Agent 在当前工作区串行完成；没有实施 Worker 或 worktree。代码与核心验证完成，最终人工交付验收/归档尚未进行。

## 实际改动

删除自托管 GPU 服务、独立 Python 协议辅助、专属 Python 测试、GPU Python CI 和部署说明：mcp/laya_batch_server.py、integrations/laya-gpu/、tests/test_laya_server.py、.github/workflows/laya.yml。原服务能力按用户明确确认退出，不声称完成等价 Node GPU 引擎。

清理 package 分发清单中 GPU README，受管 runtime 禁止携带全部已退出 GPU 资产；README、System One 运行协议及受影响产品/架构/运维/质量快照改为仅 Node.js 客户端连接外部兼容服务。修正活动运维说明中残留的 Python 验证入口。

保留 mcp/laya_http_mcp.js、System One 四工具及 Laya/Jev 客户端：端点/认证、批请求/响应协议、超时、缓存和 fallback 行为不变。Laya 服务由操作员通过 LAYA_BASE_URL / LAYA_API_KEY 配置，推理模型、硬件和服务端批处理由外部提供方负责；不新增本地推理依赖、不下载模型、不执行 Python。

## 实际验证

使用独立 Node.js 24.21.0，并为子进程临时选择该 Node 的 PATH，不升级工作区 root node_modules。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 核心完整验证 | exit=0，9 个 required checks 全通过 | /tmp/osm-node-only-core.log |
| Node 项目回归 / Agent 回归 | 159 + 4 = 163 项通过，失败/skip 均为 0 | 同上 |
| Python 源码 / 活动 CI 前置 | 第一方 Python=0，GPU/Python CI 与依赖入口缺失检查通过 | 同上；新增 Node retirement 回归 |
| 语法 / runtime 资源 / static source | 119 JS 语法与 81 runtime source 检查通过，无 Python fallback | 同上 |
| lock / ownership / ignore | 两份 lock 字节一致，原锁与用户资产保护检查通过 | 同上 |
| 文档 | docs: valid | 同上；Delivery 写入后再次检查 |
| 安装 shell / dry-run | 通过，不改用户目标、不调用 npm 或 endpoint | 同上 |
| 隔离消费包 | 真实安装/文档/观测/ZIP/System One MCP smoke 通过，GPU 资产不在包中 | 同上 |

可复验入口：Node.js 24.21.0 的 node scripts/sdd_validate.js --profile core；其包括全部 Node 回归、零 Python 审计、文档、安装和真实 tarball 消费。新增回归要求服务/专属 CI/依赖不复活，npm pack 场景同时确认 Node 客户端仍在分发中。

## 保全与自审

删除前保全本次受影响服务/CI/manifest 到 /tmp/osm-gpu-retirement.nGqPU9/service-before-removal.tgz；原整工作区备份仍在 /tmp/osm-before-manual-node.LYGajX。历史 Change、调查、Git 和兼容 wire/database fixture 保留，不执行历史 Python；不卸载用户解释器、不清理用户虚拟环境。

获准删除与保留能力清晰区分，未跳过 Node 客户端测试，未添加零 Python 例外或成功占位。此前 GPU 未决/检查失败的记录保留为授权前事实，C01/C02/任务计划明确记录新的人工决定与结果。

## 剩余验证与交付边界

本轮核心完整验证已经通过；不将它声称为外部推理/模型/GPU 硬件验证。之前扩展 profile 的 Docker daemon/镜像、Claude CLI 缺失、Research 平台包/网络和 Mermaid renderer 环境问题仍记录在 C03-04；本次未重新执行这些与删除服务无关的验证，没有宣称扩展 profile 全绿或维持失败豁免。Codex/OpenCode 原生结果可复用此前未受影响证据。

没有提交、公开发布、全局安装或归档；用户确认本次结果后再按授权处理最终交付。

[已确认宏观任务](C03-05-01-task.md) · [原调查事实](C03-05-02-investigation.md) · [任务计划](../C03-task-plan.md)
