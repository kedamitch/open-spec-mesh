# C03-01｜诊断内核实现交付

## 实际改动

- `lib/installation/models-config.js`：
  - 导出只读思考档位白名单常量 `VALID_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'default']`。
  - 导出纯函数 `diagnoseModelsConfig(homeDir)`，执行文件存在性、JSON 解析与顶层对象校验、4 个核心角色必填字段覆盖率分析及非法档位识别，生成结构化诊断结果报告（包含 `roles`、`unknownRoles`、`globalIssues`、`suggestions`、`overallStatus` 与 `exitCode`）。
- `tests/node/dsh/models-config.test.js`：
  - 补充对 `VALID_REASONING_EFFORTS` 常量完整性与不可篡改性的断言。
  - 补充针对文件缺失（status=ok, exitCode=0）、语法损坏/非对象（status=error, exitCode=1）、完整合规（status=ok, exitCode=0）及字段缺失/非法档位（status=error, exitCode=1, suggestions 完备）的 5 组针对性单测。

## 验证与自审

- 执行 `node --test tests/node/dsh/models-config.test.js`：12 个测试全部通过（pass 12 / fail 0）。
- 自审核对：未篡改任何已有导出方法或 `DEFAULT_MODELS` 默认值，新诊断函数为纯函数且支持自定义 `homeDir`，无外部副作用。
