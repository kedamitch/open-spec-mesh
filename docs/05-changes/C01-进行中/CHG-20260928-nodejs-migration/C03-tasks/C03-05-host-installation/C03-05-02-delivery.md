---
status: submitted
revision: 0d78ad12d8c188a4db8313201b11225dc944b524
attempt: 2
contract_digest: e02428d08cd1e01fd1785c3538ceb4db29f9a431e1ddba00d11f2902866fbeed
baseline: 2ac3a03806727cafc187238ab106e35c60cc3c9d
---

# 任务交付报告

## 文件改动

> **交付结果**：提供本地 npm tarball 可运行的 Node 三宿主安装器，并修复非 Git tarball 安装时可选 Git 历史探测向 stderr 泄漏 fatal 的问题。

| 文件 | 操作 | 行为影响 |
| --- | --- | --- |
| `AGENTS.md` | M | Main 协调文档将 SDD 日常入口、prepare 和 integrate 改为公开 Node CLI。 |
| `agents/architect.toml` | M | Architect 创建 Task 的指令改用 `open-spec-mesh new-task`。 |
| `agents/dispatch-contract.md` | M | 正式派发流程从 Node CLI 生成 dispatch packet。 |
| `agents/worker.toml` | M | Worker 交付指令改用 `open-spec-mesh sdd deliver`。 |
| `config.toml` | M | System One MCP 配置改用 Node 入口，并继续默认禁用。 |
| `docs/05-changes/C01-进行中/CHG-20260928-nodejs-migration/C03-tasks/C03-05-host-installation/C03-05-02-delivery.md` | M | 记录此前 C03-05 实现与验证结果；本轮正式报告刷新 attempt 2 的 revision、Git stderr 回归和交付证据。 |
| `install.sh` | M | POSIX shell 入口将原参数透传给 Node 安装器并保留其退出状态。 |
| `lib/installation/cli.js` | A | 安装命令薄入口将参数交给 installer。 |
| `lib/installation/host-adapter.js` | A | 为 Codex、OpenCode、Claude 生成宿主原生配置及角色/Skill 资产。 |
| `lib/installation/installer.js` | A | 执行安装预检、三宿主计划、runtime/Skill staging、Research 工具配置和安全发布。 |
| `lib/installation/migrations.js` | A | 解析兼容 ownership manifest 并迁移旧受管布局；非 Git tarball 的可选 rev-parse 探测静默失败，真实 Git 源仍纳入 AGENTS.md 历史 catalog。 |
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
| `tests/node/installation/installer.test.js` | A | 覆盖安装参数、dry-run、宿主 staging、迁移与拒绝/保全分支；新增无 .git packaged-source 子进程回归，断言安装探测 stderr 为空且 dry-run 不创建 Home。 |
| `tests/node/installation/migrations.test.js` | A | 覆盖 ownership、manifest 版本兼容和损坏/不安全输入；新增双提交真实 Git 仓库回归，确认 catalog 保留当前与历史 AGENTS.md blob。 |
| `tests/node/installation/runtime-stage.test.js` | A | 验证发行文件选择、Python/GPU/测试排除和锁一致性。 |
| `tests/node/installation/skill-wrappers.test.js` | A | 在无 Python 的 PATH 下验证两个 Skill shell wrapper 的帮助、参数透传和退出码。 |
| `tests/node/installation/toml.test.js` | A | 验证 TOML 更新保留无关语句字节并拒绝歧义输入。 |
| `tests/node/installation/tools.test.js` | A | 验证 Research 密钥检查、环境脱敏及自定义/disabled 服务保全。 |
| `tests/node/installation/transaction.test.js` | A | 验证故障发布回滚、恢复数据保留和路径安全。 |

## 验证结果

- **结论**：通过。

| AC / 场景 | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| `AC-10` | Node 24.21.0 下构建本地 tarball，并以一条 npm exec 命令执行 Codex 安装 | 通过 | `npm pack --json --pack-destination /tmp/osm-c03-05-validation-yK91p2/rework-artifacts` 退出码 0，产生 301 文件 tarball（329,826 bytes，unpacked 1,009,697 bytes），其中含本次 `lib/installation/migrations.js`。随后以隔离 HOME/cache 执行 `env -i HOME=/tmp/osm-c03-05-validation-yK91p2/npm-exec-home USER=fatfei PATH=/tmp/osm-node2421-gt2xhr/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin TMPDIR=/tmp/osm-c03-05-validation-yK91p2 NPM_CONFIG_CACHE=/tmp/osm-c03-05-validation-yK91p2/npm-exec-home/npm-cache NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_YES=true npm exec --yes --package=/tmp/osm-c03-05-validation-yK91p2/rework-artifacts/open-spec-mesh-0.1.0.tgz -- open-spec-mesh install --skip-tools --host-home /tmp/osm-c03-05-validation-yK91p2/npm-exec-home/codex`，退出码 0；runtime 依锁安装且 ownership manifest 更新。stderr 只有 npm 更新提示，不含 Git fatal。之前 attempt 2 的隔离验证还覆盖三宿主 dry-run/安装/重复安装及安装后 Skill wrapper。未改写用户默认 Home、未认证 Provider。 |
| `AC-11` | 安装、ownership、迁移、配置保全、升级与恢复定向测试 | 通过 | 在隔离副本 `/tmp/osm-c03-05-validation-yK91p2/source` 用 Node 24.21.0 执行 `node --test tests/node/installation/*.test.js`：38 passed、0 failed；覆盖 ownership/legacy manifest、非受管资产、symlink、disabled/custom MCP 与 rollback/recovery。 |
| 无 Git 的 packaged source | `installHost` dry-run 子进程 stderr 与目标 Home 检查 | 通过 | 隔离安装包由 `RUNTIME_INTERNALS.packageFiles(...)` 复制且不含 `.git`；`node --test tests/node/installation/installer.test.js tests/node/installation/migrations.test.js` 中回归断言子进程退出码 0、stderr 为空、dry-run 未创建 Home。 |
| 真实 Git catalog 历史 | migration catalog 两次提交历史回归 | 通过 | 同一 Node 定向测试创建临时 Git 仓库，提交两版 `AGENTS.md` 并确认 catalog 同时包含两个 blob hash；证明 stderr 抑制未改变真实 Git 历史读取。 |
| Tarball 清单、发布锁与消费者隔离 | 本地打包及既有解包检查 | 通过 | 本轮 tarball 共 301 文件且包含更新后的 migrations 模块；前次 attempt 2 已从隔离 tarball 解包执行 `npm ci --ignore-scripts --offline` 并核验发布锁与消费者资源，包不含 tests、Python 实现或 `node_modules`。 |
| 已安装 Skill wrappers | 临时安装布局、无 Python PATH 的 close/release 命令检查 | 通过 | 前次 attempt 2 使用仅含 Node 24.21.0 与 `dirname` 的 PATH；close-change `--help`=0、缺失 Change=1，new-release `--help`=0、创建 release=0、重复版本=1；含空格路径及 `--root` 参数正常。 |
| 修改文件静态/差异检查 | `git diff --check -- lib/installation/migrations.js tests/node/installation/installer.test.js tests/node/installation/migrations.test.js` | 通过 | 退出码 0，无 whitespace/error 输出。 |

## 自审结论

- **已修复问题**：npm exec 从非 Git tarball 运行时，安装器对可选 Git 根目录探测不再把预期 fatal 输出到 stderr；仅忽略该探测 stderr，成功 Git 仓库仍读取 AGENTS.md 历史。新增无 Git 安装与真实 Git 历史两侧回归。
- **契约偏差**：无

## 剩余问题

- **未验证项**：无
- **剩余风险**：全仓测试/build/static validation 按流程待 Main 集成后执行；本 Task 未公开发布 npm registry、未认证 Provider 或调用模型；无法证明 ownership 的旧/用户资产继续保留，不自动清理。

## 快照影响

- **范围**：multiple
- **说明**：Worker 未修改 Current Truth；集成后由 Main 按实际 integrated diff 同步 Node runtime/发行能力及本地 npm 安装运维入口快照。
