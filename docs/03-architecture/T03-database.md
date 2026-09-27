# 数据库与存储

## 存储概览

研发状态仍保存在 Markdown、Task Graph JSON、角色 TOML 和 Git 对象。最终集成验证 receipt 保存在 Git common dir 的 `sdd-validation/`，用于证明某个 Change 的指定 revision 实际通过了版本化 Validation Entry Point；不进入 Task Graph，也不提交业务仓库。离线行为诊断使用独立 SQLite，只保存可重建观测，不作为研发状态权威源。

## 当前结构

Task Graph 根对象只有 `tasks` 数组。字段校验由 [task_graph.py](../../sdd-change/scripts/task_graph.py) 定义；下表说明本项目运行时实际用法。Path Contract 不进入 Graph，仍是 Task Design 的人类可读边界，并在 Delivery 时对真实 Git diff 做机械校验。

| 字段 | 类型 | 约束 / 生命周期 |
| --- | --- | --- |
| id / path | string | 唯一 Task 标识、当前 Change 的 Task 目录下直接子项 |
| depends_on | string[] | 已知且不重复的 Task ID；禁止自依赖和环 |
| state | string | planned / running / submitted / accepted / blocked |
| history | object[] | 每次状态转换及被撤销的旧执行字段 |
| contract_digest | string | 共享 Change + 当前 Task 引用 AC、共享 Design + 当前 Task 引用 Dxxx/关系行、Own Task Design |
| baseline / workspace | string | 本轮 Git 起点与分配工作区；prepare 写入 |
| attempt | integer | prepare 后的正整数，恢复执行递增 |
| agent_session | string | 可选 Worker 会话/thread 标识；spawn 后绑定，用于返工时恢复原上下文，不作为身份认证 |
| result_revision / report_digest | string | submitted/accepted 的结果提交与当前报告摘要 |

Change index 的标识、活动状态和工件映射见 [sdd_common.py](../../sdd-init/scripts/sdd_common.py)。验证 receipt schema=1，包含 `change / revision / entrypoint(path+sha256) / passed / exit_code / stdout_sha256 / stderr_sha256`；运行前先写失败态使旧成功失效，归档重新核对。安装受管清单 `.open-spec-mesh-managed.json` 记录包标识、schema、skills、roles，结构以 [install_migrations.py](../../scripts/install_migrations.py) 为准.

## 一致性与限制

单项目锁序列化状态写入，文件原子替换防止半写；依赖关系由真实 Git 祖先检查约束。Current Truth 不储存未实现状态。摘要不是语义等价证明，操作者 flag 和 `agent_session` 都不是身份认证；多步骤操作也不是数据库事务。

## 观测 SQLite

默认位于 CODEX_HOME 下 `sdd-observe/observations.sqlite3`，项目外，文件权限 0600。schema version=1，application_id=0x5344444F；外来库和不支持版本拒绝读写，不自动迁移。

```sql
CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    scope_key TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    report_json TEXT NOT NULL
);
```

`scope_key` 绑定项目指纹、根会话/turn、操作者期望、Change 和显式分组成员；同 ID 不可指向不同范围。`report_json` 仅含归一化事件、会话元数据、规则指纹、SDD 快照、诊断和指标，不复制原始对话、命令、工具输出、源码和凭据。

重复采集原子替换同 Run，不追加重复样本；批量逐 Run 提交。Task history 时间缺失保留 null。来源指纹不证明配置当时生效；库内容不反向修改代码、规格或任务图。
