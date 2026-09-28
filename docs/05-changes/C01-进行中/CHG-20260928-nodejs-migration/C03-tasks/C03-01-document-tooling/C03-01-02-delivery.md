---
status: submitted
revision: a015cdac052bf419a9c11e5c5f9c3e641f823322
attempt: 2
contract_digest: 0febdf0c58a0bec4ff445ee2f1a97418fb20dabd250aa0d85196b7455b61bf7d
baseline: a2170defde70084d181b712f03b2987baff53a76
---

# 任务交付报告

## 文件改动

> **交付结果**：修复共享目录锁 owner 发布窗口的误报竞态，并保留无 owner / 损坏 owner 的 fail-closed 与人工恢复边界。

| 文件 | 操作 | 行为影响 |
| --- | --- | --- |
| `lib/runtime/locks.js` | M | owner JSON 改为同目录原子写入并 rename，避免竞争者读到半写文件；owner 缺失或 JSON 尚不完整时在 1 秒发布窗口内重试，持续损坏则报人工恢复且保留锁；发布失败不递归删除锁目录。 |
| `tests/node/runtime/lock-worker.js` | M | 测试 worker 可按参数使用 `store` namespace 并发起前发出同步标记，以复现 Observation receipt 使用的共享锁路径。 |
| `tests/node/runtime/paths-locks.test.js` | M | 增加跨进程、部分 owner 原子补全后正常排队的回归；验证长期缺失/损坏 owner 仍失败关闭且锁证据保留，既有 SIGKILL 精确 token 恢复断言保留。 |

## 验证结果

- **结论**：通过

| AC / 场景 | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| `AC-01` | Node 24.21.0 下执行 C03-01 定向测试、锁并发/崩溃恢复回归及修改文件语法检查 | 通过 | `npm run test:document-tooling`：29/29；`node --check` 三个修改文件通过；同一套件实际运行 store namespace 竞争者、原子补全、死锁 fail-closed 与精确 token 恢复；`git diff --check` 及 Task Path Contract 检查通过。 |
| `AC-02` | 重跑文档初始化、编号、Change/Task、Research/ADR、迁移和校验回归 | 通过 | 同一 C03-01 定向套件 29/29；scaffold 保全/幂等、并发编号、planned Graph、旧 docs 原字节迁移及失败回滚均通过。 |

## 自审结论

- **已修复问题**：确认旧实现将目录创建与 owner 直接写入分开，且竞争者在固定 10ms 后将合法发布窗口误判为损坏。现在 owner 通过原子写入发布；竞争者只等待/重试，不以超时接管或删除锁。owner 发布异常与持续缺失/损坏均保留锁状态并失败关闭。
- **契约偏差**：无

## 剩余问题

- **未验证项**：无
- **剩余风险**：发布窗口为 1 秒；若持锁进程在目录创建后长时间停顿，竞争者会保留锁并失败关闭、要求人工检查，而不会自动接管或删除。

## 快照影响

- **范围**：technology
- **说明**：集成后应在共享 Node runtime 技术快照中记录原子 owner 发布与 fail-closed 并发等待语义；Worker 未直接修改 Current Truth。
