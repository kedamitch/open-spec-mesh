# Worker 交付

传给 `open-spec-mesh sdd deliver --evidence-file` 的正文固定使用下面五节。revision / baseline / attempt / contract_digest 由脚本写入；`deliver --draft` 自动生成真实 Git 文件行和 Task AC 行，Worker 只填写实际行为与证据。

```markdown
## 文件改动

> **交付结果**：一句话说明这个 Task 实际交付了什么能力。

| 文件 | 操作 | 行为影响 |
| --- | --- | --- |
| `src/example.js` | M | 说明用户/系统行为发生了什么变化 |

## 验证结果

- **结论**：通过

| AC / 场景 | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| `AC-01` | 实际命令或场景 | 通过 | 关键输出 / 断言 |
| 边界场景 | 实际检查 | 通过 | 关键结果 |

## 自审结论

- **已修复问题**：无
- **契约偏差**：无

## 剩余问题

- **未验证项**：无
- **剩余风险**：无

## 快照影响

- **范围**：technology
- **说明**：需要同步的 Current Truth 主题及原因。
```

固定枚举：

- **结论**：`通过 / 部分通过 / 未通过`。
- **AC 结果**：`通过 / 失败 / 未执行`。
- **快照范围**：`无 / product / technology / operations / multiple`。
- Task Contract 引用的每个 AC 必须且只能出现一次；可以追加不绑定 AC 的边界/回归场景。
- 总体写“通过”时，不得存在失败/未执行 AC、契约偏差或未验证项。
- “部分通过 / 未通过”仍可形成真实 Delivery，但不能被机械验收门放行。
- 文件表必须与本轮 `baseline..revision` 的真实 Git diff 完全一致，并符合 Path Contract。
- Delivery 的“通过”只是 Worker evidence；Main 仍必须显式核对并执行 Acceptance。
