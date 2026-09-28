---
integrated_revision: pending
product: pending
technology: pending
operations: pending
---
# 变更说明

> **目标**：将 Open Spec Mesh 第一方消费端平台迁移为可由一条显式 npm 命令安装的 Node.js 工具包，保留现有宿主能力、SDD 行为、协议、数据和安全边界。

## 背景与问题

目前用户需 Python 3.11+ 执行安装器、SDD 生命周期、文档工具、SQLite 观测和诊断；显式启用 System One 还会安装 Python MCP SDK。Research 工具另外需要 Node/npm。用户希望统一消费端运行环境，减少外部 Python 前置依赖，而不是只增加 npm 包装层。

2026-09-28 的只读审计确认 75 个 tracked Python 文件，其中消费端逻辑、仓库质量辅助、测试、Docker fixture 和独立 GPU 服务职责不同。本 Change 按完整平台能力迁移，不按文件扩展名清理全部 Python。既有 Task/契约/观测是用户数据，不能为了换语言重新分配身份、重置或自动 replan。

## 目标与范围

### 目标

- Node 承载第一方消费端安装/Adapter、SDD、文档工具、观测/诊断及 System One MCP/HTTP 客户端；正常消费无需 Python、pip 或本地编译工具链。
- 一条明确且可重复的 npm CLI 调用配置所选宿主；下载包与配置宿主是显式动作，生命周期脚本不隐式修改 Home。
- 继续读取/写入当前 canonical 工件、冻结摘要、安装 ownership、validation receipt 和 observation SQLite；操作、flags、JSON 字段及错误保护保持。

### 本次包含

- npm artifact、Node 公共 CLI、已安装 Skill 的 Node 入口与自包含 runtime 布局；本地 tarball 分发 smoke。
- Codex/OpenCode/Claude Code 安装、配置渲染、升级回滚、Research MCP 及原有环境变量边界。
- init/migrate、文档编号/索引/校验、Change/Task 创建、Research/ADR、Release 及完整 SDD 生命周期。
- Codex trace、非 Codex artifact-only observation、兼容 SQLite 读写及私有离线 ZIP。
- Codex-only/default-off System One 的四个 MCP 工具、Laya/Jev transport、模板、缓存/熔断与 fallback。
- 默认/生成的 Node 验证入口、原有回归场景的 Node 测试、CI、Skills/角色操作引用与使用指南。

### 本次不做

- 不迁移任意下游项目或替用户改写其业务验证命令；明确配置的 Python 业务项目仍可调用自己的解释器。
- 不迁移独立 GPU-host Laya/CUDA 推理栈；保留可独立部署的 Python 服务及其协议辅助，排除在 npm 消费包之外。
- 不保证 `python3 path/to/old-script.py` 继续可用；保证的是 Node 入口上的操作/flag/JSON 语义，并移除第一方消费路径上的旧调用。
- 不保证旧 Python 与新 Node 同时写同一状态；升级须停止旧写进程，采用一版本一次写入。
- 不发布 npm 公共包、不申请 registry 名称或凭据；本地 artifact 可验收，公共发布是独立 release 前置条件。
- 不增加宿主、Windows 支持、常驻调度器、非 Codex 私有 trace 支持、模型权限或自动验收。
- 不把未实施计划写成 Current Truth，不改写其他 Change 或已完成历史工件。

## Requirements

- **R01｜Node 消费运行时**：消费包的实际实现为 Node；不得通过 Python wrapper、pip、node-gyp 或 shell-to-Python 回退伪装迁移。
- **R02｜显式 npm 安装**：包提供明确的 install CLI；默认宿主和原安装选项保留，无自动 Home 写入生命周期脚本。
- **R03｜行为与数据兼容**：保留身份、状态、摘要、协议、ownership、SQLite 和安全不变量；升级不自动 replan/reset。
- **R04｜验证责任归属**：平台默认验证使用 Node；用户项目命令继续归用户所有，receipt 仍由真实 revision-bound 执行产生。
- **R05｜完整执行规划**：实现前形成公共 Design、整张 Graph 和全部 Task Design；并行能力按真实产物依赖决定。

## 行为与验收标准

### AC-01｜Node 公共运行基础与发行骨架

- **行为**：Node 24.21.0+ 的 ESM artifact 具备显式 CLI/稳定模块定位、纯 JS/WASM 依赖与无 Home 写入生命周期；安全路径、项目锁、原子替换和 Python 兼容编码为各模块提供公共实现。缺失模块/资源显式失败，不回退 Python。
- **验证**：定向测试检查 engine、bin/files、CLI 参数/退出码、跨 cwd 与有空格路径、序列化黄金向量、锁并发/崩溃、symlink 和同目录原子写；安装依赖使用 ignore-scripts 且不需要编译。后续全包 smoke 由 AC-12 完成。

### AC-02｜文档创建与旧 docs 保全

- **行为**：Node 能创建 canonical scaffold、编号/索引、Change/Task、Research/ADR；可校验文档，安全迁移旧 docs；保留模板正文、工件命名、planned Task schema 和旧 docs 原字节。
- **验证**：移植原 scaffold/编号/模板/迁移/文档用例；测试并发分配、无模板/坏索引/重复编号/路径逃逸、迁移失败恢复及生成的 Node Validation Entry Point 指引。

### AC-03｜完整规划、冻结与状态门保持

- **行为**：完整性/readiness、AC/Dxxx/Graph 对照、精确 scoped contract digest、五种 Task 状态、history 与 rework/replan 保护保持；已有合法冻结记录在正文未变时摘要不漂移。
- **验证**：基线黄金契约含 CRLF/Unicode/无变化维度；缺任一设计/流程/引用不能派发；修改引用项触发漂移、修改非引用兄弟项不误伤；确认和 workers-stopped 保护保持。

### AC-04｜执行、交付、验收及集成保持

- **行为**：prepare/resume/session/baseline/attempt、leaf cwd、Path Contract/真实 diff、结构化 Delivery、显式接受、单 Task/wave ancestry 集成保持；下游只在上游精确 revision 已集成后解锁。
- **验证**：隔离 Git 仓库的完整主链、并行兄弟 Task、stale attempt、报告篡改、失败/未验证 AC、冲突 wave、idempotence、session 改绑及三宿主命令构造回归。

### AC-05｜项目验证、receipt、归档与 Release 保持

- **行为**：新默认入口为 Node；项目可显式声明 argv 命令，兼容已有 Python script 声明而不把 Python 当平台依赖；receipt schema=1、入口/输出摘要、revision 与归档保护保持。Release 生成和检查保持。
- **验证**：Node/显式业务命令/既有 .py fixture 的调度测试，缺解释器不假成功；失败先使旧 receipt 失效；入口漂移、HEAD/项目变更、未集成结果不能归档；Release 模板与 checklist 回归。

### AC-06｜跨宿主观测与现有 SQLite 兼容

- **行为**：Codex full trace 与其他宿主 partial/unsupported 保持；使用实际 state home 优先级，不恢复过期 CODEX_HOME 默认。已有 application_id=0x5344444F/user_version=1/runs schema 数据可读写，scope key、幂等和 unknown 语义保持。
- **验证**：原 trace/usage/group/history 用例等价测试；既有 SQLite 字节 fixture 的读/更新/重开、Python 黄金 scope key、外来库/未知版本/权限拒绝、并发更新及中途失败保全。

### AC-07｜私有离线诊断能力保持

- **行为**：诊断零网络/模型调用，输出项目外私有 ZIP；保留范围披露、manifest/文件摘要、coverage、不复制原始敏感载荷与拒绝覆盖用户文件。
- **验证**：空证据、缺失证据、最新 turn/child/项目发现、symlink/path traversal、文件模式、失败发布和 ZIP 解包校验；拦截网络/模型/子进程证明诊断无新增调用。

### AC-08｜Node System One MCP 客户端保持

- **行为**：四个工具名和 JSON/text 结果、模板、typed answers、权限过滤、Laya true-batch、显式 Jev、去重、缓存、熔断、partial/fallback/关闭语义保持；不自动切换 provider或扩权。
- **验证**：SDK stdio client 与 Node server 真正 list/call 测试，加 HTTP fake backend 的协议/超时/对齐/重定向/大整数/缓存/关闭/密钥脱敏用例；无 Python/pip。

### AC-09｜GPU Python 服务明确隔离且仍可部署

- **行为**：独立 Python Laya 服务和必要协议辅助仍可按既有 HTTP/CUDA 契约部署；消费 npm tarball 不含这套实现，不将其解释器依赖传播到客户端。
- **验证**：npm file list 排除 Python 实现；已有 GPU API factory/FakeRouter 协议回归移到独立 lane；保留 GPU-only依赖/启动/fast-no-CPU-fallback 说明，不宣称已执行真实 CUDA 推理。

### AC-10｜一条显式 npm 命令安装并可重跑

- **行为**：从本地 tarball 以 `npm exec --yes --ignore-scripts --package=<绝对路径.tgz> -- open-spec-mesh install --host <host>` 配置宿主；可追加原安装选项，重复运行幂等。真实安装默认仍要求 Research key；core-only 可显式加 --skip-tools。
- **验证**：隔离 cache/Home、无 Python PATH 下，对三宿主执行该单调用的 tarball smoke、重复安装和 dry-run；用户 Home 在仅获取/安装包而未调用 install 时保持不变。公共 registry E404 不作为本地 artifact失败，也不宣称已发布。

### AC-11｜宿主升级、ownership 与工具安全保持

- **行为**：默认 Codex、全部 host/Home/工具/docs/System One flags 保持；用户配置/正文/凭据及 custom MCP 保留；同名非受管资产拒绝覆盖；受管旧布局安全升级为自包含 Node runtime，失败恢复；System One 非 Codex fail closed。
- **验证**：移植安装/TOML/manifest/Research/Adapter 回归，含旧 .py bridge识别、特殊 TOML 值、未受管/损坏 manifest、故障注入、Node依赖安装失败与custom MCP不探测；真实工具和 host smoke不产生模型请求。

### AC-12｜纯 Node 消费验证与完整回归证据

- **行为**：所有第一方消费操作和指南不再要求 Python；Node全量入口执行平台 required tests/build/static checks。原 422 个静态测试方法逐项映射到 Node 等价场景或明确独立 GPU lane，不以 skip/删除测试取得通过；Docker Python fixture 可保留。
- **验证**：消费端无 Python环境的完整功能/打包测试；迁移覆盖清单、语法/文档/角色/包内容检查和 CI矩阵，保留 Mermaid/Docker/三宿主/Research/GPU lanes。Main 在最终 integrated revision 上运行 required全量及receipt；Worker只做定向验证。
- **仓库配置保全**：根 `.gitignore` 增补 `/node_modules/`，仅忽略根依赖安装产物；`package-lock.json` 保持版本控制。Main 已有用户根 `node_modules/` 必须原地保留，不移动、删除、清理、覆盖或暂存其中内容。

## 约束与待确认

### 已确定约束

- Main 于 2026-09-28 已确认本次消费迁移及上述授权边界；无额外 Complex 审批门。
- 当前基线 revision：`dc9ba409fb17632b333be679ab7b7c5b364aa4e1`。Python旧调用不承诺兼容；现有数据/协议承诺兼容。
- orderly upgrade：先停止旧写进程并保全工作区，安装后启动新 session；不自动清理用户活动Task或工作区。
- npm artifact 名称采用 open-spec-mesh，仅指本地包名，不证明 registry所有权；实际公共发布和许可证/发布凭据核对由release完成。
- Current Truth 同步只在 Main 提供已集成 diff、Delivery、验收结果后进行；本次规划不预写现状。

### 待确认

- 无影响正确规划的未决用户选择。公开发布、外部认证和真实 GPU硬件属于后续独立环境/发布条件。

## 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | 安装、SDD runtime、Routing承载、观测/诊断与可选System One，能力和权限边界不变 |
| 应用 / 组件 | Python消费逻辑改为Node ESM；增加明确npm/bin入口及自包含已安装runtime |
| Domain | 原状态机/ID不变；新增工具内部安装stage/锁owner，不写Graph |
| Database | Graph/manifest/receipt/SQLite schema不变；SQLite文件持久化实现更换，精确scope编码兼容 |
| API / Protocol | Node入口、原动作/flags/JSON语义；验证声明增加显式argv命令；MCP/HTTP既有协议不变 |
| Operations | Node前置、显式npm安装、一版本升级、纯Node平台验证；GPU Python独立说明 |

<!-- SDD:EVIDENCE:BEGIN -->
## 验证结果

pending

## 最终结论

pending
<!-- SDD:EVIDENCE:END -->
