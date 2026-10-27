# 执行计划

## 范围与交付

遵循 [根因与设计](../C02-design.md)，把 preset-sdd 从"能挂载"修到"运行时成立"，并同步安装器、包元数据与文档。三段边界见 C02 开头：A 决定运行时行为，B 决定安装产物，C 只描述已发生事实。目标与验收见 [C01-change.md](../C01-change.md)。

## 执行方式与集成

三段由 Main 在当前工作区串行完成：未派发 Worker，未新建 worktree，未另起并行分支。顺序理由是依赖真实存在的——B 要改 `dsh/gatekeeper.mjs` 的 import，只能等 A 把该文件重写完成；C 写的是 A/B 的结论，先写就会变成未落地的声明。共享输入：宿主实现（`/usr/local/lib/node_modules/@deepseek-ai/dsh/`，只读）与仓库现有测试。

真实挂载冒烟只在临时 profile 内进行，并在结束时完整回滚（备份 `package.json`，`dsh plugin remove` 后与备份 `diff`）。

## 整体验证方向

- 定向单测：`node --test tests/node/dsh/*.test.js`（`gatekeeper.test.js`、`install-dsh.test.js`、`models-config.test.js`）。
- 静态审计：`node scripts/check_runtime.js`（语法、包文件范围、锁文件、静态资源计数）。
- 组合层面：`dsh --profile web --patch ./dsh/cordis.patch.yml --dump-config` 退出码与关键片段。
- 挂载层面：`dsh plugin --profile web add <repo>` → `--dump-config` → `remove` → 与备份 `diff`。
- 明确不承诺：以上任何一项都不证明运行时 hook 在真实会话中按预期生效，见 [C04-delivery.md](../C04-delivery.md) 的未验证清单。

## 任务与依赖

- [C03-01｜运行时接线](C03-01-runtime-wiring/C03-01-01-task.md)：段 A；无前置依赖，是 B、C 的事实来源。
- [C03-02｜安装器与模型配置](C03-02-installation-and-models/C03-02-01-task.md)：段 B；依赖 C03-01（插件改为引用 `lib/installation/models-config.js`）。
- [C03-03｜文档与包元数据](C03-03-docs-and-package-metadata/C03-03-01-task.md)：段 C；依赖 C03-01、C03-02 的实际结论。

三段的实施记录分别见各自的 Delivery；跨段验证与未验证清单汇总在 [C04-delivery.md](../C04-delivery.md)。

## 计划与授权的对应关系

用户授权的是"按报告修复 + 冒烟 + 补文档"（见 C01 的用户授权）。本计划是执行者据该授权编制的任务拆分，不声称获得逐项批准；本 Change 未 commit、未发版，归档与发布由人决定。
