# GPU Node 迁移：事实与停止点

> 历史调查：2026-09-29 GPU 能力退出授权前的事实与停止点，保留原始调查结果；不代表当前未决状态。

原 Python 服务仍承担真实 GPU 推理、跨 state 批量、shared serial inference gate、token budget 拒绝、CUDA/无 CPU 回退、bearer auth 和队列/请求/模型限制。Node HTTP/MCP 客户端不是该服务的替代实现。

已核对社区 Node Laya 引擎线索，但没有证据证明上述关键行为全部等价；不因名称相似新增推理依赖、下载模型或伪造服务实现。此前向用户提出是否允许取消仓库内自托管 GPU 服务、保留 Node 客户端对接外部服务，尚未获得答复。

因此保留 mcp/laya_batch_server.py、integrations/laya-gpu/contracts.py、tests/test_laya_server.py 及其 GPU CI/依赖，不执行 Python。零 Python 检查没有豁免并真实失败。

用户若要求保留该能力，需继续核实可实现同等行为的 Node 后端；用户若明确授权退出自托管能力，才删除对应实现、测试/CI/依赖并验证客户端兼容。未经此决定，不降低 AC12/AC13，不宣称整仓已迁移。

[宏观任务](C03-05-01-task.md) · [整体实施结果](../C03-04-distribution/C03-04-02-delivery.md)

## 后续决定

用户现已明确答复“可以移除自托管GPU服务，只保留nodejs”。此前停止点已解除，采用能力退出并验证 Node 客户端；本调查不再作为当前实施阻塞。
