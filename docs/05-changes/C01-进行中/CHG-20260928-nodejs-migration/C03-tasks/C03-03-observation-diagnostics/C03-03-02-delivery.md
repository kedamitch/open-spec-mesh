---
status: submitted
revision: e14ae6e433a140672a0935538a66baa66a98dbf7
attempt: 1
contract_digest: a0d87189b6aa6745fb28a7ac9c783d5e75641a5baf0990875feff9c21e539e7b
baseline: 95a4717ff26d5cf841fe6ddad1bbc3a54a710874
---

# 任务交付报告

## 文件改动

> **交付结果**：完成 Node 跨宿主观测、兼容 SQLite 持久化及私有离线诊断 ZIP，并更新 Node 操作入口与定向验证。

| 文件 | 操作 | 行为影响 |
| --- | --- | --- |
| `lib/diagnostics/bundle.js` | A | 按项目与近期 turn 筛选 Codex 证据，递归仅消费已确认关联的 child；规范化归档、哈希 manifest，并以私有权限排他发布离线 ZIP。symlink 与缺项降低 coverage。 |
| `lib/diagnostics/cli.js` | A | 解析诊断范围、期望模式/角色与输出；校验项目和私有路径，错误时只报安全摘要且不报告成功包。 |
| `lib/observation/cli.js` | A | 提供 collect/scan/report/group/summary Node CLI，保留 JSON 与格式语义、跨宿主策略及 state-home 优先级；拒绝项目内数据库。 |
| `lib/observation/collect.js` | A | 读取显式 rollout/快照和 SDD 工件，按 turn/child 范围归一化数据；未知、部分证据和 scan 排除保持可见。 |
| `lib/observation/diagnose.js` | A | 移植确定性 finding、指标、Markdown/JSON 报告、summary 与显式分组；不从缺席或 partial 推断成功/失败。 |
| `lib/observation/store.js` | A | 以 sql.js WASM 读取兼容 SQLite，验证 schema/scope，逐 run 事务导出校验并原子发布；私有权限、目录锁和失败保全。 |
| `lib/observation/trace.js` | A | 解析 Codex rollout、工具/协作事件、usage 与规则信号；保留大整数并丢弃原始参数/输出等敏感载荷。 |
| `sdd-diagnose/SKILL.md` | M | 将诊断技能入口与示例切换到 Node bundle 命令，说明离线和隐私边界。 |
| `sdd-diagnose/references/usage.md` | M | 将诊断操作步骤与参数示例更新为 Node 入口。 |
| `sdd-diagnose/scripts/bundle.js` | A | 新增固定 registry 可调用的 Node 薄入口，转发到共享诊断 CLI。 |
| `sdd-do/references/observation.md` | M | 将观测安装路径、命令和定向测试指引更新为 Node；说明 host 与数据库边界。 |
| `sdd-do/scripts/observe.js` | A | 新增固定 registry 可调用的 Node 薄入口，转发到共享观测 CLI。 |
| `tests/fixtures/migration/observation/foreign.sqlite3` | A | 提供 Python sqlite3 生成的非本产品 ownership 数据库，验证拒绝写入时原字节保全。 |
| `tests/fixtures/migration/observation/golden.sqlite3` | A | 提供含合成历史 run 的 Python sqlite3 兼容数据库，用于 Node 读取、更新和重开验证。 |
| `tests/fixtures/migration/observation/provenance.json` | A | 记录 golden fixture 的来源、schema/app ID、scope JSON/hash 与合成数据标记。 |
| `tests/fixtures/migration/observation/unsupported-version.sqlite3` | A | 提供不支持 schema version 的合成数据库，验证不会自动迁移或覆盖。 |
| `tests/node/diagnostics/bundle.test.js` | A | 断言近期选择、缺失/部分 evidence、child/重复 ID、脱敏与 ZIP manifest、权限和发布拒绝策略。 |
| `tests/node/observation/cli.test.js` | A | 验证 CLI JSON/报告、跨宿主 partial、无效参数、state-home 和项目内 DB 拒绝。 |
| `tests/node/observation/collect.test.js` | A | 验证 turn 与 child 关联边界、usage unknown、artifact-only coverage 和显式 Change 历史。 |
| `tests/node/observation/compatibility.test.js` | A | 覆盖 legacy 语义、扫描边界、malformed header/symlink omissions、数据库失败保全与无子进程/网络。 |
| `tests/node/observation/helpers.js` | A | 提供纯合成 rollout 行、结束事件及敏感哨兵，供隔离测试复用。 |
| `tests/node/observation/static-safety.test.js` | A | 静态约束生产观测/诊断模块不引入网络请求或子进程执行。 |
| `tests/node/observation/store-worker.js` | A | 作为隔离子进程写入独立 run，供跨进程首次建库和锁竞争测试使用。 |
| `tests/node/observation/store.test.js` | A | 验证 Python SQLite golden、scope hash、schema/权限/sidecar 拒绝、幂等冲突、导出失败保全和并发无丢失。 |
| `tests/node/observation/trace.test.js` | A | 验证 trace 脱敏、lossless usage、命令保守分类、状态解析、malformed 行与策略信号。 |

## 验证结果

- **结论**：通过。

| AC / 场景 | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| `AC-06` | Node 24.21.0 下运行观测与诊断定向套件 | 通过 | 33/33；Python sqlite3 golden 读取/更新/重开及 scope provenance、foreign/unsupported DB 字节保全、跨宿主 partial、并发首次建库和无丢 run 均有断言。 |
| `AC-07` | Node 24.21.0 下运行离线 bundle、安全与边界测试 | 通过 | 33/33；合成敏感哨兵未进入归档，manifest 哈希可重算，ZIP 私有权限/固定路径/新建排他发布及项目、Git、symlink 目标拒绝均有断言。 |

## 自审结论

- **已修复问题**：并发首次建库中 lstat/mkdir 竞态曾导致 `EEXIST`；现重查竞争创建的目录并验证类型，store 套件连续三次通过。诊断 discovery 现对 symlink 排除计入 partial，scan 报告 symlink omission；模块相对 Skill 路径使用 `fileURLToPath` 兼容 URL 转义路径。
- **契约偏差**：无

## 剩余问题

- **未验证项**：无
- **剩余风险**：sql.js 按整库载入 WASM 内存；超大既有数据库的峰值内存未用生产数据测量。本 Task 按契约未接触真实私有 trace/生产 DB，结论只覆盖 synthetic fixtures；全仓集成验证由 Main 执行。

## 快照影响

- **范围**：multiple
- **说明**：影响观测/诊断产品能力、Node + SQLite WASM 技术实现及其操作入口；依 Task 边界未改 Current Truth，全部 Task 集成后由 Main/Architect 按集成 diff 同步。
