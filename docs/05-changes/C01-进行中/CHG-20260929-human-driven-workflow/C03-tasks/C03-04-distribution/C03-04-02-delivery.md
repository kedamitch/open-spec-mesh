# C03-04｜安装分发与质量入口：实施与验证记录

> 2026-09-29，当前 Agent 串行实施。主要改动已落地；全量检查和部分扩展验证未通过，不作完成/验收声明。

## 实际结果与修复

三宿主受管 Rules/Skill/Role 渲染分发新流程，保留用户模型/provider、ownership、未受管资产、事务回滚和升级语义。README、公开帮助、tarball smoke、Current Truth 与 Node 验证入口同步；没有 npm 发布、全局安装或用户环境清理。

原生 OpenCode smoke 暴露安装器输出了 opencode2 格式而本机 opencode 为 V1。改用 agent / prompt / permission 与直接命名 mcp 项；保留 Main/Architect 委派 allowlist、只读角色 edit deny 和模型继承。实际 1.18.31 debug config 解析通过，新增 schema/权限回归。不是放松原生解析断言。

Research smoke 原来错误地假定复用 PATH 工具也必有临时目录 manifest。新增仅 smoke 使用的禁用全局复用选项，正常安装默认不变；同时修复 npm .bin symlink 在无 ancestor manifest 的隔离目录中误判 CodeGraph 身份。相关定向回归通过。最新真实安装/CLI 仍受镜像缺少平台包及 GitHub 下载超时影响，未计成功。

## 实际验证记录

使用独立 Node.js 24.21.0，不升级工作区 root node_modules；当前默认 Node 24.19.0 不满足包引擎约定。

| 检查 | 实际结果 | 证据 / 边界 |
| --- | --- | --- |
| Node 项目回归 + agents 回归 | 158 项项目回归 + 4 项 agents 回归，共 162 项通过，零失败/skip | /tmp/osm-core-final.log；不等于 core 整体通过 |
| Agent native 配置 | 通过 | core 日志：模型/effort/sandbox/mirror，非阶段审批 |
| 119 JS syntax + runtime source/locks/ignore | 通过 | /tmp/osm-static-final.log；没有 Python fallback，lock 字节一致，用户 sentinel 保全 |
| validate-docs | 通过，docs: valid | 实际 CLI 和直接脚本均运行；格式检查仅建议 |
| isolated tarball consumer | 通过 | /tmp/osm-tarball-final.log；真实安装后文档/观测/ZIP/MCP 消费，无旧自动命令 |
| Codex native V2 smoke | 通过 | /tmp/osm-codex-check.log；本机 0.158.0，local deterministic fixture，无远程模型 |
| OpenCode native config / agents / MCP | 通过 | /tmp/osm-opencode-final.log；1.18.31，无模型请求 |
| Node MCP SDK | 2 项通过 | /tmp/osm-mcp-final.log；不证明 GPU 推理 |
| 原历史/lock 保全 | 通过 | /tmp/osm-preservation-final.log；原迁移 Change 23 文件与备份字节一致 |
| zero-first-party-Python / validate:core | 失败，exit=1 | 剩余 3 个 GPU Python 文件；没有豁免，后续 core 检查被 fail-fast 停止 |
| Docker fixture runtime | 失败 | /tmp/osm-docker-check.log 镜像层 EOF；重试 /tmp/osm-docker-recheck.log daemon 操作超时；不是 fixture 通过 |
| Claude native smoke | 未执行，返回失败 | /tmp/osm-claude-final.log：CLI 缺失；生成配置的 Node 回归不冒充原生结果 |
| Research managed npm/CLI smoke | 失败 | /tmp/osm-research-final.log：平台 bundle 缺失、GitHub 下载超时；不含认证请求 |
| Mermaid full renderer | 本轮未执行 | 不以语法/文档检查替代真实 renderer |
| 安装 shell syntax / dry-run | 通过，dry-run exit=0 | /tmp/osm-install-dry-final.log；本次命令 PATH 临时选择 Node 24.21.0，不写用户目标 |

日志为本机临时证据；可复验命令为 Node 24.21.0 的 scripts/sdd_validate.js --profile core、scripts/verify_tarball.js、scripts/verify_opencode.js、scripts/verify_codex.js、scripts/verify_laya.js、scripts/verify_docker.js、scripts/verify_claude.js、scripts/verify_research_tools.js，以及 bin/open-spec-mesh.js validate-docs --root .。缺少前置环境仍需解决，不以历史失败豁免。

## 自审与快照影响

产品流程、角色路由、安装/API/存储/领域、运维、质量和图表按已实现事实同步，明确 GPU 未迁移；旧审查和 Change 记录保留。用户原始未提交修改以 /tmp/osm-before-manual-node.LYGajX 保全，不把全部原 Node 迁移 diff 冒认本轮新增。没有提交、归档或最终交付审批。

## 继续条件

先由用户决定 C03-05 GPU 能力边界，再落实完整 Node 目标并解决适用扩展验证条件；重新收敛实际失败后提交结果供用户确认。本 Task 不能因消费 npm 包不含 Python而宣布全仓迁移完成。

## 2026-09-29 后续：GPU 退出已确认

本记录正文保留 GPU 授权前的实现结果、未决项及失败证据。用户后续已明确允许删除自托管 GPU，服务与专属 Python 测试/CI/依赖现已退出；最新核心完整验证 exit=0，9 项检查与 163 项 Node/Agent 回归通过，Python=0。最新事实见 [C03-05 实施结果](../C03-05-node-gpu-service/C03-05-03-delivery.md)。此前 core 失败不再是当前结果；扩展验证尚未全绿，不把核心通过当作最终人工验收。
