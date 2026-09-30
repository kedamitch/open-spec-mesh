# Node 22、全局安装与旧脚本清理：实施记录

> 2026-09-29，当前 Agent 串行实施；本记录将在真实 Home 升级验证后补充结果，不代表人工验收或 npm 发布。

## 真实改动

- 版本下限统一为 >=22.0.0，包可分发；dependency 版本保持原固定值，两份锁保持相同字节。
- 修复独立已安装 Skill/MCP 的模块启动；不依赖 Node 24 自动识别，不改变用户整体模块作用域。
- 真实本地/全局 npm 消费测试覆盖 PATH bin、含空格目录、已安装 Skill 与 SDK MCP；npm 不擅改 Home。
- 安装事务执行旧资产退役，受管 Skill 整体替换，识别旧 Python MCP 并定向移除 helper 和缓存；无关脚本保留。
- 升级前备份：/tmp/osm-node22-global-P6WTop（源代码与受影响 Codex 受管资产，私有权限）。

## 首轮最低版本失败与修复

Node 22.0.0 首轮发现模块 fixture/独立 wrapper 启动失败，以及 private 旧测试断言；修复后已通过核心 9 项检查。失败未 skip，未提高版本下限，历史 Node 24 证据不改写为 Node 22。

## 最终本轮验证

- Node 22.0.0 + npm 10.9.2：核心 profile exit=0，9 项 required checks 全通过，160 项项目 + 4 项 Agent 回归共 164 项通过，零失败/skip。日志 /tmp/osm-node22-core-final.log。
- 当前 Node 24.19.0 + npm 11.17.0：同一核心 profile exit=0，9 项检查全通过，164 项回归通过。日志 /tmp/osm-node24-core-final.log。原 Node 24.21.0/163 项结果只作前一轮证据，不改写。
- 新增源码目录 npm -g 路径回归后，以 Node 22.0.0 再执行真实本地/全局消费者测试，exit=0；tarball 全局安装与源码目录全局链接均可从含空格的其他目录运行 PATH bin，安装后的 Skill entrypoints 可执行，SDK MCP 保留四个工具。日志 /tmp/osm-node22-global-final.log。
- syntax audit 119 个 JS，第一方 Python=0，两份锁 byte-identical；dependency 固定版本不变。
- git diff --check、文档结构与链接检查通过。既有 Node 迁移 Change 的 23 个文件逐字节与本轮前备份一致。

## 当前 Home 的实际升级

已执行 node bin/open-spec-mesh.js install --host codex --skip-tools，exit=0，而非只跑 dry-run。升级前的私有备份包含原受管 Skill/MCP 的 39 个 .py 与 18 个 .pyc/.pyo；升级后这些受管目录计数均为零。用户点名的四个旧文件以及旧 MCP helper/cache 均不存在。

从备份解包到私有对照目录核对：原有用户 model/provider 与非受管 MCP 配置语义保持一致；备份包含的 7 个非受管资产逐字节一致。全局消费者隔离测试另行证明 user-tool/script.py 不被删除。没有扫描后无差别删除其他 Skill、系统 Python 或用户 Python 环境。

实际 Home 已安装 Skill 的 init-project/new-change/new-release --help 用 Node 22.0.0 启动成功；MCP --input 返回 disabled fallback，未启用服务、未调用外部推理。配置已改为 Node bridge 且保持 enabled=false；升级后再次 dry-run 通过。

原前置完整备份 /tmp/osm-node22-global-P6WTop（目录 0700，归档 0600）保留。安装器自身的事务完成后会删除临时回滚目录，这不表示前置备份不存在。

## 自审与边界

- 没有以 experimental flags 或提高到 22.9 来掩盖最低版本问题；仅受管 Skill 声明 ESM，独立 MCP 不改用户整体 module type。
- 新增删除操作仍由安装事务执行；只对明确归属的旧资产与 helper/cache 生效，自定义 MCP 保留。
- npm install -g 只提供命令，无 Home postinstall；显式 install 才升级宿主，不推进人工阶段。
- 当前会话可能仍有载入的旧 Skill 描述；新会话读取磁盘上的新规范。旧历史 session 不改名、不重建。
- 本轮没有执行 registry 发布、Git 提交或 Change 归档。扩展 full profile 未重新完成，不能用本轮 core 全绿冒称外部宿主/渲染/Docker/真实推理全绿；实现结果仍待用户确认。
