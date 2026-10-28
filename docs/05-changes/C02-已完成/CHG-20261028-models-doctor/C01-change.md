# 模型配置可观测性诊断 (osm models doctor)

## 背景与问题

Open Spec Mesh 在 DSH 架构下通过 `~/.dsh/osm-models.json` 配置 4 个专职子代理角色（`architect`, `worker`, `explorer`, `librarian`）的模型路由与思考档位。

用户在手工或脚本维护该配置时，常见以下配置隐患：
1. **字段缺失或空置**：部分角色缺少必填的 `provider` 或 `model`，或者设置了空字符串；
2. **非法档位值**：`reasoningEffort` 误填了不支持的值（有效档位为 `none`, `low`, `medium`, `high`, `xhigh`, `max` 等）；
3. **文件与格式异常**：`osm-models.json` 语法错误、顶层非对象或包含未知的无效角色；
4. **缺乏主动校验入口**：此前仅在运行时被动通过 `loadModelsConfigWithDiagnostics` 将错误作为 problems 告警写入 `systemPrompt`，开发者在 CLI 侧无法主动自检，无法在运行前快速排查。

## 目标与范围

### 目标

1. 扩展 CLI 子命令：新增 `osm models doctor`（别名 `osm models check`）。
2. 完整性与合法性诊断：全面校验 4 个核心角色的配置状态、必填字段、合规思考档位与全局 JSON 完整性。
3. 友好可视化与可操作修复建议：以格式化表格直观呈现各角色检查结果，并为异常配置提供一键复制可用的修复建议命令（如 `osm models set ...` 或 `osm models reset`）。
4. 明确的进程退出码：健康配置退出码为 0，存在配置错误或损坏时退出码为 1，支持 CI/脚本无缝集成。

### 本次包含

- `lib/installation/models-config.js`：定义标准合法 reasoningEffort 档位常量；提供 `diagnoseModelsConfig(homeDir)` 结构化诊断函数。
- `lib/cli/models.js`：实现 `doctor` / `check` 子命令处理逻辑，格式化表格输出与修复命令生成。
- `tests/node/dsh/models-config.test.js` 或新建 CLI 针对性测试：全覆盖合规、缺字段、非法档位、JSON 损坏、别名支持与退出码验证。
- 帮助信息与相关文档更新。

### 本次不做

- 不进行在线 API / Provider 真实网络连通性探测（宿主鉴权与配额保持解耦，遵循离线自检原则）。
- 不破坏已有 `loadModelsConfigWithDiagnostics` 兼容性，不更改 4 个核心角色默认路由定义。
- 不未经用户确认擅自覆写修改用户文件。

## Requirements

- **R01 (命令入口)**：`osm models` 支持 `doctor` 和 `check` 子命令；`osm models` 帮助文本与错误提示同步更新。
- **R02 (诊断逻辑)**：
  - 校验 `osm-models.json` 是否存在、JSON 格式是否正确、顶层是否为对象；
  - 检查 4 个固定角色（`architect`, `worker`, `explorer`, `librarian`）是否齐全；
  - 检查每个角色的 `provider` 与 `model` 是否存在且非空字符串；
  - 检查 `reasoningEffort` 是否属于受支持的档位（`none`, `low`, `medium`, `high`, `xhigh`, `max` 等）；
  - 检查是否存在未识别的冗余角色定义。
- **R03 (输出与修复建议)**：
  - 终端输出格式化的对齐表格：包含角色名称、Provider、Model、Effort、诊断状态（OK / WARNING / ERROR）；
  - 在表格下方针对发现的问题分类输出修复建议，给出具体的 `osm models set <role> ...` 或 `osm models reset` 命令。
- **R04 (退出码规范)**：
  - 配置有效且完全无错误时返回 0；
  - 配置文件语法错误、顶层类型错误、缺少必填字段或包含非法档位等异常时返回 1。

## 行为与验收标准

### AC-01｜无配置文件或默认状态
- **行为**：当 `~/.dsh/osm-models.json` 不存在时，`osm models doctor` 输出文件未创建说明，展示 4 个角色均按系统默认（DEFAULT_MODELS）生效，状态为 OK，并给出可选的自定义创建建议，命令退出码为 0。
- **验证**：单元测试指定空临时目录，执行 `doctor` 验证输出与 exitCode=0。

### AC-02｜完全健康配置
- **行为**：当 `~/.dsh/osm-models.json` 完整且 4 角色均合法时，表格各行均标记为 OK，无修复建议，命令退出码为 0。
- **验证**：写入合法配置运行 `doctor`，断言输出含全部 OK 且 exitCode=0。

### AC-03｜缺字段与非法 Effort 档位
- **行为**：当角色缺少 `provider` 或 `model`，或 `reasoningEffort: "ultra"` 时，表格相应行标记问题，下方输出针对该角色的 `osm models set <role> --provider ... --model ... --effort ...` 建议，命令退出码为 1。
- **验证**：构造缺字段及非法 effort 用例，断言捕获具体错误及 exitCode=1。

### AC-04｜JSON 语法损坏或顶层格式非法
- **行为**：当 `osm-models.json` 内容畸形或为数组/非对象时，直接输出文件解析失败提示，并建议执行 `osm models reset` 重新生成默认文件，命令退出码为 1。
- **验证**：构造畸形内容用例，断言捕获解析异常及 exitCode=1。

### AC-05｜子命令别名与帮助
- **行为**：`osm models check` 输出与 `osm models doctor` 保持一致；`osm models` 未知子命令帮助提示包含 `doctor|check`。
- **验证**：断言两个子命令行为一致且 help 文本匹配。

## 约束与影响范围

### 已确定约束
- 保持对 `dsh/gatekeeper.mjs` 中现有 `buildRoleRoutesSection` 与 `loadModelsConfigWithDiagnostics` 的 100% 向后兼容。
- 输出采用无额外三方依赖的轻量字符表格排版，符合整体极简风格。

### 影响范围

| 维度 | 影响 |
| --- | --- |
| 产品模块 | `osm models` CLI 诊断与可观测性体系 |
| 应用 / 组件 | `lib/cli/models.js`, `lib/installation/models-config.js` |
| Domain | 子代理模型路由规范与校验 |
| Database | 无 |
| API / Protocol | CLI 命令集增加 `osm models doctor` 与 `osm models check` |
| Operations | 提供开发者排查与修复模型配置的操作入口 |
