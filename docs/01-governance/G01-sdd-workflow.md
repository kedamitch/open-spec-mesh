# 项目研发约定

## 工程范围

本仓库交付 SDD Skills、5 个子角色配置和本地 Python CLI；没有业务数据库或常驻业务服务。运行依赖 Python 3.11+、Git 和 POSIX 文件锁。

## 文档主线

```text
Current Truth
  → C01 Change
  → C02 Design
  → C03 Task Graph + Task Design
  → Implementation
  → Task Delivery
  → Integration Wave
  → Next Wave / Final Integration
  → Update Current Truth
  → Full Validation
  → Release
```

`C03-task-graph.json` 只保存拓扑和运行状态；人类设计事实在 Design / Task Markdown。

## 工作入口

只保留 Quick / SDD：

- **Quick**：Main 连续完成，可按需使用 Explorer / Librarian；不创建 Change / Task。
- **SDD**：Architect 一次性形成 Change、Design、Task Graph 和全部 Task Design；Main 忠实按 Graph 派发 Worker，不二次拆分。
- 冻结 Contract 必须变化时仍需用户明确确认后 replan。
- Reviewer 只在用户明确要求时启用。

## 验证与合并

执行 [验证规范](../08-quality/Q01-validation.md)，按 Task 协议完成冻结、工作区派发、逐文件 Delivery、验收与 wave 集成；`status` 用 Git ancestry 恢复集成进度，不在 Graph 复制状态。最终集成后由 Architect 同步 Current Truth，Main 再做全量验证与归档。CI 必须对应准确提交；历史成功不能替代本轮结果。源码、配置和文档都纳入 diff，用户秘密不进入工件。
