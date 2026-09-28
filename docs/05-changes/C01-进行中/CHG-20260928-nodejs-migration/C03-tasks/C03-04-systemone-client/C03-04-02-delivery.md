---
status: submitted
revision: 090e28a81358baea51d74765e3aeacf7c925bc44
attempt: 1
contract_digest: 1f7941c3b3ba87ce1ef2dfddbe44696f2dae53ad87d87b927a1519398ea1adb2
baseline: 95a4717ff26d5cf841fe6ddad1bbc3a54a710874
---

# 任务交付报告

## 文件改动

> **交付结果**：交付 Node.js System One MCP/HTTP 客户端、可供安装器消费的 launch/config API 和独立 GPU Python helper；保留 GPU 服务入口及协议，Node 消费文件清单排除 GPU 服务。

| 文件 | 操作 | 行为影响 |
| --- | --- | --- |
| `integrations/laya-gpu/README.md` | A | 说明 GPU API 是独立 Python/CUDA 部署、环境和启动 flags；没有声称已部署或运行硬件推理。 |
| `integrations/laya-gpu/contracts.py` | A | 将 GPU 服务专用模型列表、编码、问题和答案验证独立为 Python helper，不成为 Node 客户端依赖。 |
| `lib/systemone/cli.js` | A | 提供 Node `--input` 单次 JSON 和默认 stdio 入口；限制输入大小/字段并在错误时输出稳定 fallback。 |
| `lib/systemone/contracts.js` | A | 集中 provider/env/config、工具 schema、验证、launch-shape 和兼容编码；schema golden 对齐基线 Python MCP 实际 `ListTools`。 |
| `lib/systemone/http.js` | A | 使用 Node fetch 执行受限 HTTP；限制超时、请求/响应体并拒绝重定向，失败不泄露凭据。 |
| `lib/systemone/index.js` | A | 导出 System One 模块与 installer 可消费的共享配置/launch API。 |
| `lib/systemone/mcp.js` | A | 用低层 SDK 暴露原四工具；调用结果保留 JSON 字符串 text envelope，不添加 structuredContent。 |
| `lib/systemone/metrics.js` | A | 以私有权限写入脱敏指标；指标写失败不改变建议结果。 |
| `lib/systemone/policy.js` | A | 从本地角色描述构造候选并应用角色权限 guard，保持建议不授予权限。 |
| `lib/systemone/runtime.js` | A | 实现模板决策、Laya batch/Jev single、去重与 pinned cache、circuit、fallback 和指标。 |
| `lib/systemone/stdio.js` | A | 增加 lossless JSON-RPC stdio 适配，保留数值 token/unsafe 数字 ID，并限制 frame 大小。 |
| `lib/systemone/templates.js` | A | 安全读取内置及显式自定义模板，维持版本 ID、schema 与 digest 检查。 |
| `mcp/laya_batch_server.py` | M | GPU 服务改从独立 helper 加载验证函数；原服务 factory、启动入口和 HTTP/CUDA 服务边界保留。 |
| `mcp/laya_http_mcp.js` | A | 提供 Node source/installed thin entry，按固定布局定位 runtime 与 settings，不依赖当前工作目录。 |
| `tests/fixtures/migration/systemone/case-map.json` | A | 将旧 System One 决策用例逐项映射至本 Task、本地 GPU lane 或后续验证 Task。 |
| `tests/fixtures/migration/systemone/tool-schema.golden.json` | A | 固化四工具基线 schema/description，包含 Python MCP 实际生成的 title 与 docstring 文本。 |
| `tests/fixtures/migration/systemone/wire-golden.json` | A | 固化 Laya batch、Jev single、MCP request/text response 的兼容 JSON 编码向量。 |
| `tests/node/systemone/systemone.test.js` | A | 增加 Node System One 协议、策略、HTTP、SDK stdio、source/installed root、lossless、错误路径和包排除测试。 |
| `tests/test_laya_server.py` | M | 增加 GPU helper 的独立验证及既有 fake-router HTTP factory 回归，不启动真实模型。 |
| `typesafe-laya/references/runtime.md` | M | 将消费端示例切至 Node 入口，并区分独立 GPU Python/CUDA API 部署。 |

## 验证结果

- **结论**：通过

| AC / 场景 | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| `AC-08` Node System One MCP 客户端 | Node 24.21.0 `node --test tests/node/systemone/*.test.js`；真实 SDK Client 经 stdio list/call 四工具；fake HTTP 覆盖 batch/single、fallback、timeout、redirect 和体积边界 | 通过 | 23/23 通过；`--input` 在 Node-only PATH 下运行；schema fixture 与 Node 工具定义一致。独立基线 Python MCP 2.2.0 `ListTools` schema/description 对照精确匹配。 |
| `AC-09` GPU Python 服务隔离且可独立部署 | `/tmp/open-spec-mesh-c03-04-gpu-test-venv/bin/python -m unittest discover -s tests -p 'test_laya_server.py' -v`；测试中 `npm pack --dry-run --json` 消费文件清单检查 | 通过 | GPU helper / FastAPI fake-router factory 6/6 通过；包文件清单断言不含 `integrations/laya-gpu/**` 和 `mcp/laya_batch_server.py`。这只是 dry-run 文件清单排除检查，不是后续 C03-05 的完整 tarball smoke。未启动真实 CUDA/模型。 |
| JSON/wire 兼容边界 | Python `json.dumps(..., ensure_ascii=False, allow_nan=False, separators=(',', ':'))` 对照四个 wire golden | 通过 | 四个向量均与 Python 编码逐字节文本相同；覆盖 Unicode、大整数、浮点类型、负零、batch/single 与 text envelope。 |
| stdio frame 过大尾帧 | Node 定向测试 | 通过 | 同一 chunk 内先有完整 frame、后接超限未结束 frame 时现在拒绝并关闭；该回归包含在 23/23 中。 |
| diff 格式与授权路径 | `git diff --cached --check`；提交文件表对照 Path Contract | 通过 | 检查通过；提交仅包含 Task allow 路径。已有 `C03-task-graph.json` 工作区修改未暂存、未提交、未还原。 |

## 自审结论

- **已修复问题**：自审发现手工 schema golden 缺少基线 Python MCP `ListTools` 中实际的 title/docstring 格式，已按观测结果修正并锁定测试；发现 stdio 同一 chunk 含完整 frame 后的超大未结束尾帧未被检查，已修复并增加边界回归。
- **契约偏差**：无

## 剩余问题

- **未验证项**：无
- **剩余风险**：非阻塞验证记录：2026-09-28 17:39:29 +08:00（oracle 输出文件 mtime，近似结束时间）基线 Python MCP oracle 调用了 `laya_status`；旧实现执行配置服务 `GET /health` 并附加 Bearer key，结果为 `service_unavailable`，到达情况未确认，且无可核验网关日志。用户已明确无需担心此次潜在外发、无需签发新 key；不推动轮换。未记录密钥、完整 endpoint、Authorization 或工具返回值；之后未再调用真实 Provider。真实 CUDA 推理及完整 npm tarball smoke 属于明确排除项/后续 C03-05，不代表服务已部署或真实硬件已验证。

## 快照影响

- **范围**：technology
- **说明**：新增 Node System One 消费端及独立 GPU helper 的技术边界需要在整 Change 集成后同步 Current Truth；Worker 未修改快照。
