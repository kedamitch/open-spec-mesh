# 运行协议

System One 消费端由 Node.js 22.0.0+ 的 `mcp/laya_http_mcp.js` 提供；无需 Python 或本机编译工具链。自托管 GPU 服务已按用户确认退出，只保留 Node.js 客户端连接操作员提供的外部兼容服务；不会下载模型、启动本地推理或调用 Python helper。

## 工具

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| laya_templates | 无 | 列出本地模板、用途和必填状态；无模型调用 |
| laya_decide | decision、items、context?、model? | 加载固定问题，批量执行，按 ID 返回精简建议 |
| laya_predict | state、questions、model? | 原型试验；不用于每次重新编写契约 |
| laya_status | 无 | 显式排错；health 不证明认证、推理或 GPU 加速 |

## 委派请求

```json
{
  "decision": "delegation@1",
  "items": [{"id": "job-3", "state": {"request": "定位跨模块的消息重试调用链"}}],
  "context": {
    "current_role": "main",
    "execution_mode": "quick",
    "available_roles": ["explorer", "librarian"],
    "known_context": "当前角色只知道入口，尚未阅读实现",
    "cost_evidence": "暂无计费和返工测量数据"
  }
}
```

delegation@1 只判断“当前角色是自己执行，还是委派给它此刻允许的哪个候选”。调用方仍传 current_role、available_roles 和必要状态；运行时先按内部权限与当前状态过滤，再把**过滤后的局部候选**放进 executor Choice。模型看不到未被当前角色允许的其他角色，因此不会得到全局 Routing Graph。current_role、available_roles 和 execution_mode 的枚举值会自动去除首尾空白并转为小写；未知枚举仍拒绝。候选 criteria 只注入当前角色及其局部候选的职责描述；不会附带其他角色说明。available_roles 只能进一步收窄运行时允许集合，不能扩权。结果只返回 recommendation.executor，不自动启动子代理。

## 返回示意（非实测）

```json
{
  "status": "ok",
  "decision": "delegation@1",
  "advisory": true,
  "results": [{"id": "job-3", "status": "ok", "recommendation": {"executor": "explorer"}, "basis": "model"}],
  "metrics": {"elapsed_ms": 0, "network_calls": 1, "cache_hits": 0, "backend": "server_batch"}
}
```

`template_hash` 标识实际模板内容。示意耗时 0 不是性能结果。每项 fallback 含 reason；顶层 partial 表示仅部分项可用。未取得结果不解释为 quick、无需复审或授权。

## 接口与批处理

provider 由 `SYSTEMONE_PROVIDER=laya|jev` 指定；未指定时固定使用 Laya。Jev 默认关闭，即使环境中存在 `TYPESAFE_API_KEY` 也不会自动切换，必须显式设置 `SYSTEMONE_PROVIDER=jev`。Laya 固定调用 `POST /v1/systemone/batch`，请求为 `{"requests":[...]}`，支持裸数组或 `{"results":[...]}` 响应。Jev 使用 TypeSafe 官方 `POST /v1/systemone`，每个不同 state 一个 HTTP 请求，body 直接是 `{"state":{},"questions":{},"model":"jev-latest"}`；多 questions 仍共享同一 state。工具层返回格式保持一致。

Laya 的外部服务由操作员提供并配置 `LAYA_BASE_URL` / `LAYA_API_KEY`，必须兼容上述合批协议；仓库不再提供服务端或 CUDA 部署。Jev 使用外部 TypeSafe 服务；认证使用 `TYPESAFE_API_KEY`，默认模型 `jev-latest`。两种后端均不启动本地模型服务；远端推理/批处理/硬件由服务提供方负责。

## 缓存与指标

只有操作员固定并设置 `SYSTEMONE_MODEL_REVISION`（Laya 仍兼容旧 `LAYA_MODEL_REVISION`）时启用跨请求的进程内缓存（60 秒、最多 256 项）。缓存键包含端点/鉴权范围、模型版本、模板内容和输入顺序；问题、选项、状态、版本变化会失效。未设置版本则不跨请求缓存；同一批内完全相同输入仍只推理一次。模型权重升级必须同时更新该版本并重启服务。

`SYSTEMONE_METRICS_PATH` 可选，填写私有绝对路径；Laya 仍兼容旧 `LAYA_METRICS_PATH`。仅记录模板哈希、数量、耗时、网络调用、缓存命中和回退计数；不记录 state、候选正文、输入 ID、密钥或响应原文。缺失数据不当零成本，不推算账单。指标写入失败不阻塞任务，响应 `metrics_written=false` 会标记。

## 无 MCP 的批量调用

将相同参数保存为 JSON，在获授权工作目录中运行：

```sh
node "${CODEX_HOME:-$HOME/.codex}/mcp/laya_http_mcp.js" --input requests.json
```

这不是前置调度器：不会自动拦截 Codex 请求、换模型或执行决策。
