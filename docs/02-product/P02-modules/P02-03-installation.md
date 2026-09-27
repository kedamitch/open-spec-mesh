# 安装与升级

## 模块定位

向独立 Codex Home 安装运行所需技能、角色和参考；不管理业务工程，也不默认复制本仓库历史资料。

## 功能与业务规则

| 场景 | 操作 | 结果与边界 |
| --- | --- | --- |
| 默认安装 | install.sh | 安装 8 个核心 Skill、2 个兼容入口、角色、受管配置和必要参考；生成精简 README / 导航 |
| 项目资料 | --include-project-docs | 显式替换目标 docs 为本包参考资料；不用于存有业务文档的目录 |
| 默认升级 | 已有安装 | 只替换选定受管项；旧 docs 原样保留、不自动删除，运行导航不再依赖它 |
| 业务项目旧 docs 迁移 | `sdd-migrate` | 显式将旧 `docs/` 原样备份到 `.sdd-migration/legacy-docs/`，建立 canonical 01–09 骨架和 Migration Map；不猜测语义、不由安装器自动触发 |
| 用户配置 | 安装 / 升级 | 保留 provider、自定义 MCP、其他角色、规则及并发设置；已识别的错误 CodeGraph 默认配置例外迁移，STDIO 密钥透传按需补齐 |
| 密钥预检 | 正式安装前检查本地环境 | CONTEXT7_API_KEY、TAVILY_API_KEY 未设置、为空或只有空白则报错；已有 MCP 不能跳过检查 |
| 研究工具 | 默认检测；--skip-tools 跳过安装 | 缺失安装 npm @latest，按工具隔离目录；正确 CodeGraph 为 @colbymchenry/codegraph，以 serve --mcp 启动 |
| 旧 CodeGraph | 识别原默认命令/受管路径/npx 配置 | 换为正确项目；旧包文件保留、不再引用，不清空共享目录或卸载全局包；自定义/禁用配置保留 |
| 预览 / 跳过 | --dry-run / --skip-tools | 均报告缺失变量；前者不改目标，后者只更新运行内容，不执行工具迁移，不代表工具可用 |
| 文件事务失败 | 暂存 / 替换异常 | 恢复本次已移动配置与技能；恢复失败保留材料，成功后的临时清理失败不回滚 |

只检查当前进程继承的变量，密钥值不回显、不落盘，也不传给 npm 安装子进程；不自动读取 `.env`，不执行 API 认证。运行时通过 MCP env_vars 透传，仍需调用环境提供变量。

研究工具沿用独立安装逻辑，不宣称 npm 副作用由配置事务全部回滚。目标 docs 默认不受管，显式完整资料模式才将其纳入本次替换。业务项目旧文档升级由独立 `sdd-migrate` 完成，和 Codex Home 安装/升级事务分离。

操作见 [本地工具包](../../04-operations/O02-applications/O02-01-local-toolkit.md)。回归覆盖密钥缺失、已配置未安装、错误包迁移、重复安装、全量与运行模式、旧文档保留和安装后入口可用性。本模块没有 UI。

## Laya 可选能力

默认安装本包 Laya MCP、固定模板和 typesafe-laya 适配技能；`--without-laya` 撤下本包技能与提示、禁用命名 MCP，跳过 Laya 环境检查与依赖安装。`--with-laya` 恢复本包受管配置，`--skip-tools` 不等于关闭。原 typesafe-ai 和无关 MCP 文件保持原状。

Laya 核心变量为 LAYA_BASE_URL、LAYA_API_KEY；配置只透传名称。检查发生在包安装前，不主动探测服务。客户端不安装 torch、Laya 权重或 CUDA。服务端必须支持 `/v1/systemone/batch`；客户端单条与多条统一调用，无需配置路径变量。升级清理受管 MCP 的旧变量透传，保留用户自定义配置。

安装语义与命令以 [README](../../../README.md) 为准；接口和模板设计见 [适配技能](../../../typesafe-laya/SKILL.md)。
