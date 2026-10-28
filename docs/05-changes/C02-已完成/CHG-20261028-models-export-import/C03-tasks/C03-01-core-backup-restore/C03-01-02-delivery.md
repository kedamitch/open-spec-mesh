# 任务交付：内核备份还原函数与单元测试 (C03-01)

## 交付物与验证

- 在 `lib/installation/models-config.js` 实现并导出 `exportModelsConfig(homeDir)` 与 `importModelsConfig(backup, homeDir, options)`。
- 覆盖 Schema v1.0.0 规范，包含 4 个核心角色验证、必填字段检查与思考档位白名单校验。
- 默认拒绝覆盖已有配置，必须显式 `overwrite: true` 方可覆盖。
- 单元测试套件 `tests/node/dsh/models-config.test.js` 包含 23 项测试全部通过（tests 23 / pass 23 / fail 0）。
