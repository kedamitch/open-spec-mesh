# 模型配置可观测性诊断 (osm models doctor)｜交付汇总

## 交付了什么

| 任务 | 实际结果 | 证据 |
|---|---|---|
| C03-01｜诊断内核实现与测试 | 导出只读思考档位白名单 `VALID_REASONING_EFFORTS`；实现并导出结构化纯函数 `diagnoseModelsConfig(homeDir)`，覆盖语法损坏、顶层非对象、字段缺失、非法档位及缺失回退检查；补充 5 组针对性单测 | [C03-01 Delivery](C03-tasks/C03-01-diagnostics-kernel/C03-01-02-delivery.md) |
| C03-02｜CLI 命令与表格交互呈现 | 在 `lib/cli/models.js` 中新增 `doctor` 与 `check` 互为别名的子命令分发；实现字符宽度自适应的等宽字符对齐表格排版渲染；格式化呈现具体问题列表并提供一键修复建议命令；根据诊断状态严格返回退出码（0/1） | [C03-02 Delivery](C03-tasks/C03-02-cli-doctor-command/C03-02-02-delivery.md) |
| C03-03｜文档与全量验证闭环 | 更新 `docs/02-product/P02-modules/P02-03-installation.md` 关于 `osm models doctor/check` 的功能描述；运行全量运行时审计脚本与相关单测；执行真实端到端命令验收 | [C03-03 Delivery](C03-tasks/C03-03-docs-and-validation/C03-03-02-delivery.md) |

## 验证证据

| 验证项 | 验证命令 | 结果 |
|---|---|---|
| 内核单测 | `node --test tests/node/dsh/models-config.test.js` | tests 12 / pass 12 / fail 0 |
| CLI 单测 | `node --test tests/node/dsh/models-cli.test.js` | tests 6 / pass 6 / fail 0 |
| 运行时审计 | `node scripts/check_runtime.js` | `Runtime audit passed: syntax=146, Python-sources=0, package-files=392, lock=3, static-files=92` |
| 真实终端执行（默认无文件） | `node bin/osm.js models doctor` | exit 0；输出等宽对齐字符表格与默认回退说明 |
| 真实终端执行（别名测试） | `node bin/osm.js models check` | exit 0；与 doctor 行为完全一致 |
| 真实终端执行（异常排查实测） | `DSH_HOME=/tmp/test-bad node bin/osm.js models doctor` | exit 1；精确标出缺失字段与非法档位，输出一键修复命令建议 |

## 验收结论

所有 5 项验收准则（AC-01 至 AC-05）均已全部满足并通过真实环境与测试套件验证，交付物已达到上线归档要求。
