# 执行计划

## 范围与交付

遵循 [公共设计](../C02-design.md) 与 [变更说明](../C01-change.md)，为 Open Spec Mesh 新增模型配置导出与还原子命令：`osm models export [filepath]` 与 `osm models import <filepath> [--force]`。
任务拆解为两个具备明确模块边界与契约隔离的独立 Task Brief 工单，便于并行派发与独立验证。

## 执行方式与集成

- **任务并行性**：
  - C03-01 负责核心模型配置导出/导入底层实现、严密格式/档位校验与覆盖门禁及内核单测（`lib/installation/models-config.js` 与 `tests/node/dsh/models-config.test.js`）；
  - C03-02 负责 CLI 参数解析、输入前置检查、友好交互呈现、错误退出码处理及命令测试（`lib/cli/models.js` 与 `tests/node/dsh/models-cli.test.js`）；
  - 在公共契约（C02-design.md）完全冻结的前提下，两项任务具备清晰的文件边界与独立的验证测试用例。
- **依赖管理**：
  - 零外部三方依赖，完全使用 Node.js 原生 API。

## 整体验证方向

- 单元测试：`node --test tests/node/dsh/models-config.test.js`。
- 命令行测试：`node --test tests/node/dsh/models-cli.test.js`。
- 端到端命令行验证：验证 `node bin/osm.js models export [filepath]` 与 `node bin/osm.js models import <filepath> [--force]` 在缺省、正常、被拦截、强制覆盖等全场景下的实际运行效果。

## 任务工单列表

- [x] [C03-01｜备份还原内核实现与单测](C03-01-core-backup-restore/C03-01-01-task.md)：在 `lib/installation/models-config.js` 实现 `exportModelsConfig` 与 `importModelsConfig`，并在 `tests/node/dsh/models-config.test.js` 编写单元测试；已完成并通过独立严格验收。
- [x] [C03-02｜CLI 导出还原子命令接入与命令测试](C03-02-cli-commands/C03-02-01-task.md)：在 `lib/cli/models.js` 接入 `export` 与 `import` 命令分发，处理参数与 `--force` 选项，更新帮助文本并在 `tests/node/dsh/models-cli.test.js` 编写命令行集成测试；已完成并通过独立严格验收。
