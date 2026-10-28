# 发布说明 (0.2.0)

> **发布摘要**：Open Spec Mesh 0.2.0 正式发布，提供 DeepSeek Harness (DSH) 预设深度集成、4 角色轻量协同模型重构，以及完善的模型配置可观测性诊断 (doctor) 与配置备份还原 (export/import) 工具链。

## 版本

- **Version**：0.2.0
- **Release Date**：2026-10-28

## Highlights

- **DSH `sdd` 预设接线深度集成**：提供完整 Cordis Patch 声明，支持在 DSH Web/CLI 一键挂载 `sdd` 预设，内置任务定级 (L0/L1/L2) 驱动的技能动态门控与角色模型路由表。
- **4 角色轻量协同模型**：彻底移除冗余的 Reviewer 角色，日常验收收归主代理独立完成；消除 Worker 微观详设负担，保障 Worker 在任务边界内的编码自治权；统一基于 Task Brief 与 5 元组返回的派发契约。
- **模型配置诊断与备份还原工具链**：
  - `osm models doctor` / `check`：等宽排版直观展示配置状态、缺漏字段与非法档位，输出一键修复建议。
  - `osm models export` / `import [--force]`：支持 Schema v1.0.0 的模型配置多环境安全备份、标准流传输与防误覆盖恢复。

## Changes

### Added

- 新增 DSH 集成层：`dsh/cordis.patch.yml`、`dsh/gatekeeper.mjs`、`dsh/index.mjs`、`dsh/icon.svg`。
- 新增 `osm models doctor`（别名 `osm models check`）诊断命令。
- 新增 `osm models export` 与 `osm models import` 配置备份与还原命令。
- 新增 DSH 与模型配置单测套件：`gatekeeper.test.js`、`models-config.test.js`、`models-cli.test.js`、`preset-rows.test.js`、`install-dsh.test.js`。

### Changed

- 4 角色规范重构：重写 `agents/{architect,worker,explorer,librarian}.toml` 提示词，聚焦宏观设计与边界内编码。
- 派发契约升级：重构 `agents/dispatch-contract.md`，规范主 Agent 协调者禁令、纯串行询问决策与并行自动派发。
- 文档规范同步更新：扩充设计模板自治自由度声明，轻量化工单模板。
- 版本基线要求：包元数据明确声明 `engines.dsh >= 0.2.1-rc.4`。

### Removed

- 彻底移除 Reviewer 子代理角色（相关 toml 配置、测试用例与派发路径清理）。

## Related Changes

- CHG-20261027-dsh-preset-wiring
- CHG-20261028-models-doctor
- CHG-20261028-models-export-import

## 最终结论

approved
