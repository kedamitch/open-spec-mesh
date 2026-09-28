# Validation

## Validation Scope

待核实。

## Validation Entry Point

待核实：填写项目内一个已提交的 Node 验证入口，例如 `scripts/sdd_validate.js`。入口负责串行执行本项目全部 required checks，任一失败返回非零；尚未配置真实 checks 时必须 fail closed。

## Required Checks

| Check | Command / Method |
| --- | --- |
| Build | 待核实 |
| Unit Test | 待核实 |
| Integration Test | 待核实 |
| Lint / Static Check | 待核实 |

## Quality Gates

- 最终集成验证必须通过 Validation Entry Point；自然语言“pass”不能替代机器 receipt。
- 待核实项目特有门禁。

## Release Validation

- 待核实。

## Known Exceptions

- 无。
