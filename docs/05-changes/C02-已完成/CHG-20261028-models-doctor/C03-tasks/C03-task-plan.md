# 执行计划

## 范围与交付

遵循 [公共设计](../C02-design.md) 与 [变更说明](../C01-change.md)，为 Open Spec Mesh 新增模型配置可观测性诊断子命令 `osm models doctor`（别名 `osm models check`）。
任务划分为三个严格串行的 Task Brief，确保内核先行、界面衔接、文档与全量测试闭环。

## 执行方式与集成

当前由 Main 代理串行就地完成：
- 顺序理由：T02 依赖 T01 的导出函数与诊断契约；T03 依赖 T01/T02 的实现结果进行事实文档同步与最终验收。
- 零第三方依赖：表格使用原生 JavaScript 字符串对齐排版。

## 整体验证方向

- 单元测试：`node --test tests/node/dsh/models-config.test.js` 与新增 CLI 针对测试。
- 静态检查：`node scripts/check_runtime.js`。
- 端到端命令行验证：验证 `node bin/osm.js models doctor` 与 `node bin/osm.js models check` 在各种配置场景下的输出表现与退出码（0/1）。

## 任务与依赖

- [C03-01｜诊断内核实现与测试](C03-01-diagnostics-kernel/C03-01-01-task.md)：在 `lib/installation/models-config.js` 实现 `VALID_REASONING_EFFORTS` 与 `diagnoseModelsConfig`，编写单元测试；依赖：无。
- [C03-02｜CLI 命令与表格交互呈现](C03-02-cli-doctor-command/C03-02-01-task.md)：在 `lib/cli/models.js` 接入 `doctor` / `check` 分支，格式化输出对齐表格、问题列表及修复建议命令，处理退出码；依赖：C03-01。
- [C03-03｜文档与全量验证闭环](C03-03-docs-and-validation/C03-03-01-task.md)：更新模块产品事实文档（`docs/02-product/`）与使用指南，执行端到端与全量回归测试；依赖：C03-02。
