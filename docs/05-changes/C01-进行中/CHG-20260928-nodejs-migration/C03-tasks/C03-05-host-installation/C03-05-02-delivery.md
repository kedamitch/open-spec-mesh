---
status: submitted
revision: 7ba37d5cde1025df01c501e009e76b8aa965d3b0
attempt: 2
contract_digest: e02428d08cd1e01fd1785c3538ceb4db29f9a431e1ddba00d11f2902866fbeed
baseline: 2ac3a03806727cafc187238ab106e35c60cc3c9d
---

# 任务交付报告

## 文件改动

> **交付结果**：提供可从本地 npm tarball 安装的 Node 三宿主运行时，并将安装、资源渲染、TOML/ownership、事务恢复及 Skill 命令接入 Node。

| 文件 | 操作 | 行为影响 |
| --- | --- | --- |
| `AGENTS.md` | M | Main 协调文档将 SDD 日常入口、prepare 和 integrate 改为公开 Node CLI。 |
| `agents/architect.toml` | M | Architect 创建 Task 的指令改用 `open-spec-mesh new-task`。 |
| `agents/dispatch-contract.md` | M | 正式派发流程从 Node CLI 生成 dispatch packet。 |
| `agents/worker.toml` | M | Worker 交付指令改用 `open-spec-mesh sdd deliver`。 |
| `config.toml` | M | System One MCP 配置改用 Node 入口，并继续默认禁用。 |
| `install.sh` | M | POSIX shell 入口将原参数透传给 Node 安装器并保留其退出状态。 |
| `lib/installation/cli.js` | A | 安装命令薄入口将参数交给 installer。 |
| `lib/installation/host-adapter.js` | A | 为 Codex、OpenCode、Claude 生成宿主原生配置及角色/Skill 资产。 |
| `lib/installation/installer.js` | A | 执行安装预检、三宿主计划、runtime/Skill staging、Research 工具配置和安全发布。 |
| `lib/installation/migrations.js` | A | 解析兼容的 ownership manifest，迁移旧受管布局并保留未知资产。 |
| `lib/installation/runtime-stage.js` | A | 按发行清单构建自包含 runtime，校验发布锁并隔离依赖安装。 |
| `lib/installation/systemone-config.js` | A | 管理 System One 的默认关闭、启用识别及自定义 MCP 保全。 |
| `lib/installation/toml.js` | A | 用字节保全的 TOML 编辑支持宿主配置更新。 |
| `lib/installation/tools.js` | A | 管理 Research 工具依赖与密钥预检，避免凭据泄漏并保留自定义配置。 |
| `lib/installation/transaction.js` | A | 以 stage/rollback 事务发布文件；恢复不完整时保留 recovery 数据并报告位置。 |
| `npm-shrinkwrap.json` | A | 提供与根开发锁字节一致的 tarball 发布锁。 |
| `package.json` | M | 扩展发行清单覆盖完整 Node runtime、Skills、模板和适配资源，并排除测试、Python 实现及 GPU 实现。 |
| `scripts/host_adapter.js` | A | 保留原宿主适配器命令名并转入 Node 模块。 |
| `scripts/install.js` | A | 提供 Node 安装 CLI 的脚本入口。 |
| `scripts/install_migrations.js` | A | 为既有迁移资源提供 Node 入口。 |
| `scripts/install_toml.js` | A | 为 TOML 编辑资源提供 Node 入口。 |
| `sdd-close/scripts/close_change.js` | M | 收口 Skill 通过共享 runtime resolver 路由到 `close-change` Node 命令，支持已安装 Skill 布局。 |
| `sdd-close/scripts/close_change.sh` | M | shell wrapper 执行相邻 Node Skill 入口，原样转发参数并透传退出码。 |
| `sdd-release/scripts/new_release.js` | M | 发布 Skill 通过共享 runtime resolver 路由到 `new-release` Node 命令，支持已安装 Skill 布局。 |
| `sdd-release/scripts/new_release.sh` | M | shell wrapper 执行相邻 Node Skill 入口，原样转发参数并透传退出码。 |
| `tests/fixtures/migration/installation/legacy-managed-host.json` | A | 固定旧 ownership manifest 的迁移输入。 |
| `tests/fixtures/migration/installation/legacy-python-bridge.toml` | A | 固定旧受管 Python bridge 配置的兼容输入。 |
| `tests/node/installation/helpers.js` | A | 提供隔离临时目录和测试流工具。 |
| `tests/node/installation/host-adapter.test.js` | A | 验证三宿主路径、配置、角色权限和 bridge 识别。 |
| `tests/node/installation/installer.test.js` | A | 覆盖安装参数、dry-run、宿主 staging、迁移与拒绝/保全分支。 |
| `tests/node/installation/migrations.test.js` | A | 覆盖 ownership、manifest 版本兼容和损坏/不安全输入。 |
| `tests/node/installation/runtime-stage.test.js` | A | 验证发行文件选择、Python/GPU/测试排除和锁一致性。 |
| `tests/node/installation/skill-wrappers.test.js` | A | 在无 Python 的 PATH 下验证两个 Skill shell wrapper 的帮助、参数透传和退出码。 |
| `tests/node/installation/toml.test.js` | A | 验证 TOML 更新保留无关语句字节并拒绝歧义输入。 |
| `tests/node/installation/tools.test.js` | A | 验证 Research 密钥检查、环境脱敏及自定义/disabled 服务保全。 |
| `tests/node/installation/transaction.test.js` | A | 验证故障发布回滚、恢复数据保留和路径安全。 |

## 验证结果

- **结论**：通过

| AC / 场景 | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| `AC-10` | Node 24.21.0 下对隔离本地 tarball 做发行、安装及三宿主安装路径验证 | 通过 | 本 attempt 的隔离 smoke 已用 `--skip-tools` 对 Codex、OpenCode、Claude 完成 dry-run/安装/重复安装；本轮重打 tarball 后验证安装布局中的 Skill wrappers 可经 runtime resolver 调用 Node CLI。未访问真实 Home。 |
| `AC-11` | 安装 ownership、配置保全、升级和失败恢复定向回归 | 通过 | `node --test tests/node/installation/*.test.js`：36 passed、0 failed；覆盖 legacy manifest、未受管资产、symlink、disabled/custom MCP 及 rollback/recovery。 |
| 已安装 Skill shell wrapper | 使用 tarball runtime 与临时 `skills/sdd-close`、`skills/sdd-release` 布局，PATH 仅含 Node 24.21.0 与 `dirname` | 通过 | close-change `--help`=0、缺失 Change=1；new-release `--help`=0、创建 release=0、重复版本=1；带空格的临时目录/`--root` 参数正常。PATH 中没有 Python。 |
| Tarball 文件及发布锁 | 隔离副本执行 `npm pack`，解包后 `npm ci --ignore-scripts --offline`，核验文件清单与锁 | 通过 | tarball 含 301 个文件及两个 shell/Node wrapper、runtime 路由、release 模板和 shrinkwrap；不含 `.py`、tests 或 `node_modules`。GPU 路径仅包含明确发行的 README。根 `package-lock.json` 与 shrinkwrap 字节一致且未修改。 |
| 脚本与 diff 检查 | `node --check` 两个 Node Skill 入口；`/bin/sh -n` 两个 shell wrapper；`git diff --check` | 通过 | 三项命令均以退出码 0 完成。 |

## 自审结论

- **已修复问题**：原 shell wrappers 仍调用 Python；改为 Node Skill 入口后又确认入口需使用共享 runtime resolver 才能在宿主 Skills 布局工作，并显式向 `isMain` 传入当前模块 URL。无 Python PATH 的 source 与 tarball-installed Skill 验证均通过。
- **契约偏差**：无

## 剩余问题

- **未验证项**：无
- **剩余风险**：全仓测试/build/static validation 按流程待 Main 集成后执行；本 Task 未公开发布 npm registry，也未认证 Provider 或调用模型（均不在本 Task 范围）；无法证明 ownership 的旧/用户资产继续保留，不自动清理。

## 快照影响

- **范围**：multiple
- **说明**：集成后技术快照需反映 Node runtime、发行资源和宿主 adapter；运维快照需反映本地 npm 安装与宿主配置入口。Worker 未直接修改 Current Truth。
