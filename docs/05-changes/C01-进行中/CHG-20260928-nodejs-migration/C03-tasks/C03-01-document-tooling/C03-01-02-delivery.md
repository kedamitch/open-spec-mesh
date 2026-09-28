---
status: submitted
revision: 3f66a13433eed73895e5bc423c2f9da2c6d2f969
attempt: 1
contract_digest: 0febdf0c58a0bec4ff445ee2f1a97418fb20dabd250aa0d85196b7455b61bf7d
baseline: f532f190864e8c4489230c7a5ef171e76ac21aa8
---

# 任务交付报告

## 文件改动

> **交付结果**：交付可从源码与本地 npm artifact 使用的 Node ESM 文档工具链、公共安全/兼容 runtime 与对应定向回归测试。

| 文件 | 操作 | 行为影响 |
| --- | --- | --- |
| `bin/open-spec-mesh.js` | A | 新增公开 CLI 二进制入口，提供 help/version 并将命令交给固定 registry 执行。 |
| `lib/cli/args.js` | A | 统一解析位置参数、布尔值、多值选项、--foo=value 与 -- 分隔符，并保留可预期的用法错误码。 |
| `lib/cli/output.js` | A | 统一 JSON、文本和错误输出，保持命令结果与诊断写入对应输出流。 |
| `lib/cli/registry.js` | A | 集中声明稳定命令路由并延迟加载；未实现模块或 handler 明确失败，不伪造成功。 |
| `lib/documents/change.js` | A | 实现 Change、planned Task 与 Design 定位创建，复用锁、编号、模板和 Graph schema 并在失败时回滚。 |
| `lib/documents/common.js` | A | 实现 frontmatter、canonical Change 映射及受安全路径约束的文档定位。 |
| `lib/documents/create.js` | A | 实现 canonical 文档编号创建，并以 fileURLToPath 正确解析含空格的模块资源路径。 |
| `lib/documents/init.js` | A | 从包内固定模板构建完整 canonical docs scaffold，预检目标并在失败时清理本次创建内容。 |
| `lib/documents/markdown.js` | A | 提取忽略 fenced code 与注释的 Markdown 可见行，供链接和契约检查复用。 |
| `lib/documents/migrate.js` | A | 将旧 docs 原字节移入备份目录后创建 canonical scaffold 与迁移映射，并在初始化失败时恢复。 |
| `lib/documents/numbering.js` | A | 提供并发安全编号、目录索引刷新和 marker 校验，分配失败时撤销新建目标。 |
| `lib/documents/research.js` | A | 按原模板创建 Research 报告及 ADR，编号分配和失败回滚均使用共享运行时。 |
| `lib/documents/validate.js` | A | 校验 canonical docs 分类、索引、命名编号、symlink、Graph 位置与相对 Markdown 链接。 |
| `lib/runtime/compat-json.js` | A | 实现 Python 兼容 JSON 编码与 lossless 数值解析，保留整数/浮点、Unicode、键顺序和黄金摘要语义。 |
| `lib/runtime/graph-schema.js` | A | 只校验 Task Graph 字段、状态、依赖与环，不实现生命周期迁移或额外写入状态。 |
| `lib/runtime/io.js` | A | 提供拒绝 symlink 的常规文件读取、独占创建、同目录原子替换、fsync 与权限保留。 |
| `lib/runtime/location.js` | A | 从源码或安装布局稳定定位 package/resource 根，并拒绝关键包路径 symlink 与越界资源路径。 |
| `lib/runtime/locks.js` | A | 提供 project/install/store owner-token 目录锁、并发等待、重入拒绝和 fail-closed 死锁处理。 |
| `lib/runtime/paths.js` | A | 规范化项目根与相对路径，拒绝路径穿越及写入路径中的 symlink。 |
| `lib/runtime/recover-lock.js` | A | 提供显式指定 namespace、目标、owner token 与 writers-stopped 的锁恢复 CLI。 |
| `lib/runtime/text.js` | A | 提供严格 UTF-8、通用换行、Python rstrip 兼容与 SHA-256 文本基础能力。 |
| `package-lock.json` | A | 锁定五个直接纯 JS/WASM 依赖及完整传递版本树，供可复现的 ignore-scripts 安装使用。 |
| `package.json` | A | 定义 Node 24.21+ ESM package、bin/export、消费白名单和精确依赖，且无隐式 Home 写入 lifecycle。 |
| `sdd-change/scripts/ensure_design.js` | A | 新增薄 Node wrapper，将 ensure-design 能力路由到共享文档实现。 |
| `sdd-change/scripts/new_change.js` | A | 新增薄 Node wrapper，将 new-change CLI 与共享 registry/bootstrap 对接。 |
| `sdd-change/scripts/new_change.sh` | M | 将原 shell 入口改为直接调用同目录 Node Change 创建脚本，不再启动 Python。 |
| `sdd-change/scripts/new_task.js` | A | 新增薄 Node wrapper，将 new-task CLI 与共享 Graph/文档实现对接。 |
| `sdd-init/SKILL.md` | M | 把 scaffold、校验和文档创建指引切换到对应 Node 入口。 |
| `sdd-init/scripts/init_project.js` | A | 新增 init-project Node wrapper，源码与安装态都从固定 runtime 调用实现。 |
| `sdd-init/scripts/init_project.sh` | M | 将初始化 shell 入口切换为同目录 Node wrapper。 |
| `sdd-init/scripts/new_document.js` | A | 新增 new-document Node wrapper，复用共享 runtime 与编号实现。 |
| `sdd-init/scripts/node_runtime.js` | A | 为源码和已安装 Skill 提供固定包根定位、动态模块加载与统一命令转发。 |
| `sdd-init/scripts/validate_docs.js` | A | 新增 validate-docs Node wrapper，返回统一验证结果与错误码。 |
| `sdd-init/templates/PROJECT-AGENTS.md` | A | 提供新项目使用的 Open Spec Mesh 操作约定模板。 |
| `sdd-init/templates/directories/02-product/P02-modules/index.md` | A | 为新 scaffold 建立产品模块分类导航入口。 |
| `sdd-init/templates/directories/02-product/P03-diagrams/index.md` | A | 为新 scaffold 建立产品图表分类导航入口。 |
| `sdd-init/templates/directories/03-architecture/T05-diagrams/index.md` | A | 为新 scaffold 建立架构图表分类导航入口。 |
| `sdd-init/templates/directories/04-operations/O02-applications/index.md` | A | 为新 scaffold 建立可部署应用文档分类入口。 |
| `sdd-init/templates/directories/04-operations/O03-diagrams/index.md` | A | 为新 scaffold 建立运维部署图表分类入口。 |
| `sdd-init/templates/directories/05-changes/C01-进行中/index.md` | A | 为新 scaffold 建立进行中 Change 的 canonical 导航入口。 |
| `sdd-init/templates/directories/05-changes/C02-已完成/index.md` | A | 为新 scaffold 建立已完成 Change 的归档导航入口。 |
| `sdd-init/templates/directories/08-quality/Q02-reviews/index.md` | A | 为新 scaffold 建立质量 Review 分类入口。 |
| `sdd-init/templates/directories/09-delivery/D01-发布记录/index.md` | A | 为新 scaffold 建立版本发布记录分类入口。 |
| `sdd-init/templates/files/01-governance/G01-sdd-workflow.md` | A | 提供治理目录下可填写的 SDD 工作流 Current Truth 模板。 |
| `sdd-init/templates/files/02-product/P01-product-overview.md` | A | 提供产品概览的初始文档结构，供项目初始化后核实填写。 |
| `sdd-init/templates/files/02-product/P03-diagrams/P03-01-product-architecture.md` | A | 提供产品架构图文档模板，保留 Mermaid 图示编辑位置。 |
| `sdd-init/templates/files/02-product/P03-diagrams/P03-02-main-user-flow.md` | A | 提供主用户流程图文档模板，保留 Mermaid 流程编辑位置。 |
| `sdd-init/templates/files/03-architecture/T01-architecture-overview.md` | A | 提供系统架构概览的 Current Truth 文档结构。 |
| `sdd-init/templates/files/03-architecture/T02-api.md` | A | 提供 API 与协议事实记录模板。 |
| `sdd-init/templates/files/03-architecture/T03-database.md` | A | 提供数据库实体、约束和迁移事实记录模板。 |
| `sdd-init/templates/files/03-architecture/T04-domain-model.md` | A | 提供领域模型与不变量记录模板。 |
| `sdd-init/templates/files/03-architecture/T05-diagrams/T05-01-system-context.md` | A | 提供系统上下文 Mermaid 图文档模板。 |
| `sdd-init/templates/files/03-architecture/T05-diagrams/T05-02-application-architecture.md` | A | 提供应用职责与依赖 Mermaid 图文档模板。 |
| `sdd-init/templates/files/03-architecture/T05-diagrams/T05-03-main-sequence.md` | A | 提供主时序 Mermaid 图文档模板。 |
| `sdd-init/templates/files/03-architecture/T05-diagrams/T05-04-domain-state.md` | A | 提供领域状态 Mermaid 图文档模板。 |
| `sdd-init/templates/files/04-operations/O01-operations-overview.md` | A | 提供环境、部署、安全、观测及恢复等运维事实模板。 |
| `sdd-init/templates/files/04-operations/O03-diagrams/O03-01-deployment-architecture.md` | A | 提供部署架构 Mermaid 图文档模板。 |
| `sdd-init/templates/files/08-quality/Q01-validation.md` | A | 将新项目默认验证入口改为 Node 命令并记录实际验证责任边界。 |
| `sdd-init/templates/scaffold-manifest.json` | A | 固定 scaffold 目录与文件清单，驱动 Node 初始化且避免猜测项目业务内容。 |
| `sdd-migrate/SKILL.md` | M | 将旧文档迁移指引及迁移后的校验入口切换为 Node 命令。 |
| `sdd-migrate/scripts/migrate_project.js` | A | 新增 migrate-project Node wrapper，复用文档迁移事务实现。 |
| `sdd-research/SKILL.md` | M | 将 Research 与 ADR 工件创建指引切换为 Node CLI 入口。 |
| `sdd-research/scripts/new_adr.js` | A | 新增 new-adr Node wrapper，调用共享编号和 ADR 模板逻辑。 |
| `sdd-research/scripts/new_research.js` | A | 新增 new-research Node wrapper，调用共享编号和 Research 模板逻辑。 |
| `tests/fixtures/migration/document-tooling/case-map.json` | A | 记录被迁移旧 scaffold、迁移、Change/Graph 与 Markdown 用例到 Node 测试的对应关系。 |
| `tests/fixtures/migration/document-tooling/compat-vectors.json` | A | 保存由基线 Python 产生的序列化黄金输入、输出与摘要，Node 测试无需 Python 即可复验。 |
| `tests/node/document-tooling/allocator-worker.js` | A | 提供独立进程编号分配测试 worker，用同步门验证跨进程互斥。 |
| `tests/node/document-tooling/migration.test.js` | A | 覆盖旧 docs 字节保全、canonical-layout 拒绝、marker 冲突与迁移失败恢复。 |
| `tests/node/document-tooling/planning-documents.test.js` | A | 覆盖 Change/Task、Research/ADR 模板与 planned Graph、编号并发及含空格资源路径。 |
| `tests/node/document-tooling/scaffold.test.js` | A | 覆盖 canonical scaffold、幂等重跑、用户文件保留、编号冲突和 symlink/marker 输入拒绝。 |
| `tests/node/runtime/cli-runtime.test.js` | A | 覆盖 manifest/CLI 参数与路由、跨 cwd/空格路径、源码/安装态定位和 tarball 白名单。 |
| `tests/node/runtime/compat-graph.test.js` | A | 覆盖 Python 编码黄金向量、lossless JSON、Markdown 可见行和 Graph schema 边界。 |
| `tests/node/runtime/dependency-smoke.test.js` | A | 实际加载精确锁定的 SDK、WASM 数据库、ZIP、TOML 与 lossless JSON 依赖。 |
| `tests/node/runtime/lock-worker.js` | A | 提供独立进程锁持有测试 worker，用于并发和 owner 崩溃恢复场景。 |
| `tests/node/runtime/paths-locks.test.js` | A | 覆盖安全路径、同目录原子写、模式保留、进程锁等待及死锁 fail-closed 恢复。 |

## 验证结果

- **结论**：通过

| AC / 场景 | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| `AC-01` | Node 24.21.0 下运行定向套件、JS 语法检查、锁定依赖安装与本地 tarball/白名单 smoke | 通过 | `npm run test:document-tooling`：27/27；所有实现与测试 JS `node --check` 通过；`npm ci --omit=dev --ignore-scripts --no-audit --no-fund` 成功安装 109 packages；tarball 安装 smoke 从含空格目录、跨 cwd 执行 init/validate 并加载 SDK/SQLite WASM/JSZip/smol-toml/lossless-json；`npm pack --dry-run --json` 80 files、无 .py/tests/node_modules。 |
| `AC-02` | 运行文档初始化、编号/索引、Change/Task、Research/ADR、迁移保全/回滚与校验回归 | 通过 | 同一 Node 定向套件中 27/27 通过；覆盖 scaffold 幂等/不覆盖用户文件、编号并发、模板和 planned Graph、旧 docs 原字节保留、canonical docs/迁移 marker 冲突及初始化失败回滚；基线用例映射与 Python 生成的兼容 golden 随包提交。 |

## 自审结论

- **已修复问题**：自审发现资源读取使用 URL pathname 会把安装路径空格编码成 `%20`，改用 `fileURLToPath` 并补含空格模块目录回归。此前误改的 Path Contract 外 `sdd-change/SKILL.md` 已撤销且未进入提交。
- **契约偏差**：无

## 剩余问题

- **未验证项**：无
- **剩余风险**：本交付仅覆盖文档工具与公共 runtime；其他 registry 能力由后续 Task 实现，当前缺失路由会显式非零失败，不宣称为已迁移。

## 快照影响

- **范围**：technology
- **说明**：集成后同步 Node ESM 消费端 package、runtime 定位与文档工具架构；Worker 未直接修改 Current Truth。
