# 整体设计

## 约束与公共约定

需求与授权见[C01](C01-change.md)。在现有只读评估上增加呈现及严格退出选项，不改evaluateCollaboration的判定、JSON schema或证据能力。报告仍只评估规范化动作；所有状态下人工检查和语义质量均未验证。保留报告路径/符号链接/大小安全限制。

| 状态 | 默认exit | --fail-on-incomplete | 含义 |
|---|---:|---:|---|
| supported_checks_passed | 0 | 0 | 已支持的动作检查通过，不是整体验收 |
| supported_check_failed | 1 | 1 | 至少一个动作检查失败 |
| incomplete | 0 | 3 | 证据不足/无可自动检查项 |

--format json|md，默认json，适用于报告和--list；非法格式exit 2。--list不执行评估，strict无判定对象，不作为验收。Markdown包含状态、检查结果、已知计数/预算、待人工核对与证据限制。

## 可调整方案与待验证假设

可在现有模块内增加小型renderer，不引入模板/依赖/新模型。内部函数与测试组织由执行者确定。假设同一CLI输出层即可覆盖需求；实施前用现有handler验证incomplete exit0，再以回归证明兼容和strict差异。若发现本身的动作判定错误，记录并仅处理受影响范围，不重开无关设计。

## 风险与验证方向

新增strict退出码是显式选项，不暗改已有脚本；Markdown必须写“动作检查”而非全绿/授权。单任务无跨模块共享契约或外部SDK变化，定向矩阵+一次集成core足够；不重复native模型夹具。
