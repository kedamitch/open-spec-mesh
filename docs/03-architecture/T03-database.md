# 存储与兼容

## 当前存储

Markdown 保存需求、人工确认、整体设计、宏观 Task、任务计划及实际 Delivery；Git 保存真实变更，不新增审批表或执行 Graph。index 是导航，可有辅助元数据但不要求旧映射字段。

## 保留的本地资源

- 安装 ownership 清单和配置：受管写入、升级/回滚依据，不是研发审批。
- 观测 SQLite：可重建只读证据，不作为研发状态权威。
- 旧 Graph/history/receipt：保全并可只读解析，不双写、不用于授权、不自动 reset。

## 观测 SQLite

默认在 CODEX_HOME 下 sdd-observe/observations.sqlite3，权限 0600；schema version=1，application_id=0x5344444F。外来库/不支持版本拒绝读写，不自动迁移。

```sql
CREATE TABLE runs (
 run_id TEXT PRIMARY KEY,
 scope_key TEXT NOT NULL,
 schema_version INTEGER NOT NULL CHECK (schema_version = 1),
 report_json TEXT NOT NULL
);
```

scope_key 绑定项目、会话与操作者期望，同 ID 不可转移范围；报告仅归一化元数据、事件、指纹和诊断，不复制原始对话、源码或凭据。重复采集原子替换，时间未知保持 null。新 Change 没有 Graph/frontmatter 是正常输入。

通用资源锁和原子写入继续保护文件与库；删除自动生命周期不取消存储权限、路径与身份范围保护。
