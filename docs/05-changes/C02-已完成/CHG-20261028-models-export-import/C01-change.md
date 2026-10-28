# 模型配置备份与还原 (osm models export / import)

## 背景与问题

Open Spec Mesh 在 DSH 架构下通过 `~/.dsh/osm-models.json` 配置 4 个专职子代理角色（`architect`, `worker`, `explorer`, `librarian`）的模型路由与思考档位。

随着开发者在不同开发机、容器或多宿主环境之间迁移工作区，或者在进行复杂调优实验时需要快速保存当前经过验证的模型配比方案，目前存在以下痛点：
1. **跨环境迁移成本高**：开发者需要手动定位并复制宿主隐式路径 `~/.dsh/osm-models.json`，若跨机器传输易出现路径层级错漏；
2. **缺乏标准备份机制**：进行临时测试或调优前，缺乏一条标准命令一键将当前生效的模型配置备份导出到指定文件或当前工程目录；
3. **缺乏安全导入恢复校验**：直接复制 JSON 文件容易引入字段缺失、语法损坏或非法思考档位等缺陷，且容易无感知地强行覆盖现有重要配置，缺乏安全覆盖防御（`--force` 门禁）与结构化校验（如复用 `diagnoseModelsConfig` 逻辑）。

## 目标与范围

### 目标

1. **导出命令 `osm models export [filepath]`**：
   - 支持将当前模型配置（合并生效配置或现有自定义配置）完整导出为标准 JSON 文件；
   - 支持显式指定导出目标路径 `filepath`；若省略，默认导出至当前工作目录下的 `osm-models-backup.json`（或 `./osm-models.json`），并在控制台明确打印导出成功的文件绝对/相对路径与摘要。
2. **还原导入命令 `osm models import <filepath> [--force]`**：
   - 支持从指定的 JSON 备份文件恢复子代理模型配置至 `~/.dsh/osm-models.json`；
   - 包含严格的导入安全校验：必须为合法 JSON 且顶层为对象、必须包含 4 个核心角色且字段合法、思考档位合规；若配置损坏或不合法，直接拒绝导入并返回退出码 1；
   - 具备覆盖防护机制：当目标 `~/.dsh/osm-models.json` 已存在且非空时，若未指定 `--force`，则拦截导入并提示目标配置已存在，指示用户使用 `--force` 确认覆盖；若传入 `--force` 则执行安全原子覆写。
3. **完善的单测与命令测试**：
   - 增加对 `exportModelsConfig` / `importModelsConfig` 内核层逻辑的单元测试；
   - 增加对 `osm models export` 与 `osm models import` CLI 的端到端执行测试（包含缺失参数、路径展开、未指定 force 拦截、带 force 覆盖、非法 JSON 拦截、部分字段合法性等）。
4. **帮助信息与文档同步**：
   - 更新 `osm models` 帮助文本与错误用法提示，涵盖 `export` 和 `import`。

### 本次包含

- `lib/installation/models-config.js`：提供 `exportModelsConfig(targetPath, homeDir)` 与 `importModelsConfig(sourcePath, options, homeDir)` 核心实现及相关错误类型与校验集成。
- `lib/cli/models.js`：实现 `export` 与 `import` 命令参数解析、默认路径处理、`--force` 标志判断、终端提示与退出码。
- `tests/node/dsh/models-config.test.js`：扩充导出与导入内核单测。
- `tests/node/dsh/models-cli.test.js`：扩充 CLI 导出与导入命令的测试用例。
- 帮助信息与相关产品/安装文档同步。

### 本次不做

- 不支持自动云端同步或远端拉取备份（遵循离线自闭环原则）。
- 不破坏已有 `loadModelsConfig`、`diagnoseModelsConfig`、`DEFAULT_MODELS` 的向下兼容契约。
- 不修改宿主级模型鉴权（allowlist 仍由宿主在调度时校验）。

## Requirements

- **R01 (命令入口)**：
  - `osm models export [filepath]`：支持 0 个或 1 个位置参数；
  - `osm models import <filepath> [--force]`：要求必须提供 `<filepath>`；支持 `--force`（以及 `-f`）选项；
  - `osm models` 的错误帮助文本同步包含 `export` 与 `import`。
- **R02 (导出行为)**：
  - 若提供 `filepath`，将配置写入指定路径（支持相对路径与绝对路径，自动创建父目录）；
  - 若未提供 `filepath`，默认写入当前工作目录的 `osm-models-backup.json`；
  - 导出的 JSON 必须是格式化缩进（2 空格）的标准 JSON；
  - 控制台输出导出成功信息与生成的文件路径。
- **R03 (导入校验与覆盖防护)**：
  - 检查源文件 `<filepath>` 是否存在，不存在则报错并以 1 退出；
  - 检查源文件内容是否为合规的模型配置（必须是对象、4 个角色定义完备、provider/model 非空、effort 在合法集合内）；若不合规，报错指出具体缺陷，拒绝写入并以 1 退出；
  - 检查目标 `~/.dsh/osm-models.json` 是否已存在：若存在且未传 `--force`，拦截写入，输出明确提示告知需加 `--force` 覆盖，以 1 退出；若传了 `--force` 或目标尚不存在，则保存并输出恢复成功提示，退出码为 0。
- **R04 (退出码规范)**：
  - 执行成功返回 0；
  - 参数缺失（如 `import` 未提供文件路径）、源文件不存在、校验失败、未加 `--force` 拦截时，均向 stderr 输出明确原因并返回 1。

## 行为与验收标准

### AC-01｜导出到指定文件路径
- **行为**：执行 `osm models export /tmp/my-models.json`，目标文件成功生成，包含当前有效的 4 个角色配置，stdout 输出成功提示与文件路径，退出码 0。
- **验证**：单测指定目标路径，验证文件内容符合当前生效配置，exitCode 为 0。

### AC-02｜导出到默认文件路径
- **行为**：在工作目录执行 `osm models export`，工作目录下生成 `osm-models-backup.json`，stdout 输出导出成功及路径，退出码 0。
- **验证**：不带参数运行导出，断言当前目录下生成 `osm-models-backup.json` 且内容正确，exitCode 为 0。

### AC-03｜导入合法配置（目标不存在时）
- **行为**：在无本地 `~/.dsh/osm-models.json` 时执行 `osm models import valid-backup.json`，成功将配置还原到目标文件，stdout 输出成功提示，退出码 0。
- **验证**：单测指定空 home 目录，执行 import，断言目标文件生成且各角色字段与备份一致。

### AC-04｜导入覆盖保护（未指定 --force 被拦截）
- **行为**：在已存在 `~/.dsh/osm-models.json` 的环境中执行 `osm models import valid-backup.json`（未加 `--force`），命令被拦截，提示目标配置已存在、若需覆盖请追加 `--force`，目标文件未被修改，退出码 1。
- **验证**：预设现有配置，执行无 `--force` 导入，断言拦截警告信息、原文件未变且 exitCode 为 1。

### AC-05｜强制覆盖导入（指定 --force 成功覆写）
- **行为**：在已存在 `~/.dsh/osm-models.json` 的环境中执行 `osm models import valid-backup.json --force`，成功覆盖现有配置，stdout 输出成功提示，退出码 0。
- **验证**：预设现有配置，执行带 `--force` 导入，断言新配置生效且 exitCode 为 0。

### AC-06｜导入非法或损坏文件被拒绝
- **行为**：若备份文件不存在、非 JSON 文本、顶层不是对象、缺少必要角色/字段或存在非法 effort 档位，执行 `osm models import` 时被拒绝，stderr 输出明确原因，原配置文件未受损，退出码 1。
- **验证**：针对不存在路径、语法错误 JSON、缺失必填字段配置分别测试，断言均被拦截且 exitCode 为 1。

### AC-07｜缺少参数与帮助提示
- **行为**：直接执行 `osm models import`（缺少文件参数）时报错退出码 1；执行未知子命令时输出包含 `export` 与 `import` 的完整用法。
- **验证**：断言报错信息包含用法提示且 exitCode 为 1。

## 约束与影响范围

### 已确定约束
- 保持与现行 `lib/installation/models-config.js` 的校验标准（`VALID_REASONING_EFFORTS`、4 个核心角色）完全一致。
- 绝不破坏已有 `osm models list|doctor|check|set|reset` 的行为逻辑。
- 采用 Node.js 原生 API，无额外引入第三方依赖。

### 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | `osm models` CLI 备份与恢复管理体系 |
| 应用 / 组件 | `lib/cli/models.js`, `lib/installation/models-config.js` |
| Domain | 子代理模型配置序列化、校验反序列化与文件原子操作 |
| Database | 无 |
| API / Protocol | CLI 命令集扩充 `osm models export` 与 `osm models import` |
| Operations | 支持配置导出分享、一键环境初始化与备份恢复 |
