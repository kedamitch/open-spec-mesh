---
name: sdd-diagnose
description: 当用户要求生成执行诊断包、打包排查 SDD/子代理/提示词问题时使用。自动收集当前项目最近执行记录，纯脚本生成私有 ZIP；不要在普通开发任务中自动运行。
---
# 生成诊断包

只执行一次脚本，不派发子代理、不调用模型分析、不手工查找会话或改业务文件。

使用当前 Skill 所在目录的 `scripts/bundle.py`，在发生问题的项目目录执行：

```sh
python3 -B <本技能绝对路径>/scripts/bundle.py --root "$PWD"
```

默认定位 Git 项目根，收集最近 7 天至多 20 个根执行片段及关联子会话，复用现有观测器生成报告、指纹和 ZIP。不要求用户提供 thread / turn / rollout 路径。仅用户明确指定时追加时间范围或 `--expected-mode` / `--expect-role`；不推测应当调用谁。

只返回脚本给出的包路径、片段数和缺失提示；不向上下文读取完整报告，不自行解释动机、不上传数据包。`no_sessions` / `partial` 如实显示，不扩大到其他项目，不反复重试或轮询。需要参数或排错时才读 [说明](references/usage.md)。
