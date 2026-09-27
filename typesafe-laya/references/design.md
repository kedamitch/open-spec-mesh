# 建立可复用判断

## 先确认收益

模板只适合“同一问题、不同输入”的重复语义工作。确定性规则写代码，相同输入用缓存；一旦需要 Codex 每次重写长状态，先比较是否直接判断更划算。衡量完整任务耗时、输入输出量、交接与返工，不以小模型毫秒数代替净收益。

## 构造请求

| 部分 | 如何填写 |
| --- | --- |
| state | 已有原始输入和必要事实，使用命名字段；不放执行指令、密钥或全仓 |
| instructions | 完整描述一个连贯判断；question ID 不承载语义 |
| criteria | Choice 是标签→解释；Score 是有序等级；Noul 可省略或给 true/false 描述 |

Choice 选项最多 20 个，优先少而清晰并包含 uncertain/none。多个标签可同时成立时分别使用 Noul，不强制互斥。独立问题可同请求；相互依赖时先取得前一结果再构造状态。Score 是等级索引的期望值，不是任意质量百分制。

以下是用 `laya_predict` 试验一个新问题的完整参数：

```json
{
  "model": "multilingual",
  "state": {"failure": "连接依赖服务时超时，尚未进入业务断言"},
  "questions": {
    "kind": {
      "type": "choice",
      "instructions": "根据已有失败证据选择类别，不判断根因或执行修复。",
      "criteria": {"dependency": "外部依赖或连接失败", "assertion": "业务断言失败", "uncertain": "证据不足"}
    }
  }
}
```

此调用只用于试验。不要把这个完整问题在每条日志上重复生成。

## 固化为数据模板

在**明确授权的目录**创建 `failure-kind.v1.json`；不要让工具返回的文字自动写入代码或全局技能。模板是纯 JSON，不执行 Python、shell 或动态导入。

```json
{
  "id": "failure-kind@1",
  "description": "重复失败条目的初步分类，不替代根因分析",
  "required_fields": ["failure"],
  "questions": {
    "kind": {
      "type": "choice",
      "instructions": "根据已有失败证据选择类别，不判断根因或执行修复。",
      "criteria": {"dependency": "外部依赖或连接失败", "assertion": "业务断言失败", "uncertain": "证据不足"}
    }
  }
}
```

操作员将 `LAYA_TEMPLATE_DIR` 设置为该私有目录的绝对路径并重启 Codex。文件名与 ID 必须一致；内置模板不能被自定义目录覆盖，符号链接和路径穿越会拒绝。正式共享模板走正常变更、评审和版本管理。

之后只调用：

```json
{
  "decision": "failure-kind@1",
  "items": [{"id": "failure-1", "state": {"failure": "连接依赖服务时超时"}}]
}
```

## 验证与采用

覆盖正常、边界、缺证据、多个可接受选项、矛盾和反例，保存代表性输入及人工标签。离线验证可以先只记录建议，不改变执行；通过后才用于适用范围。更换问题或选项含义需新版本，缓存按内容哈希失效。

检查的是任务结果和决策后果，不只是 JSON 合法。confidence/概率不等于正确率或授权；不要内置通用 0.9 放行线。对自定义模板新增自动执行动作，仍需单独的权限和确定性保护。
