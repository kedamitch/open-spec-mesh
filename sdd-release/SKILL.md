---
name: sdd-release
description: 用户要求版本发布或发布材料时使用；接受“发布 0.0.2”等自然语言，按明确的发布意图与目标版本准备、验证并执行 npm 上传。
---
# 版本发布

## npm 上传授权

真实 npm 上传以用户明确的发布意图和本次目标版本为授权依据。“发布 0.0.2”这样的自然语言指令等同于调用 `$sdd-release` 并授权上传该版本；Main 应自动使用该技能，不要求用户重写为技能口令。仅要求准备材料时不上传；没有明确发布意图时，“继续”、测试通过、授予权限或过去的发布授权不能单独产生上传授权。明确要求不上传时停止发布；不自行选择其他版本或覆盖已发布版本。

仅调用技能名或要求 Release Notes/Checklist 不自动授权上传；已有明确的本次版本发布授权后，不因用户未输入技能名而再次索要授权。用户要求“先不上传”或“仅本地测试”时，只做准备和验证，不自动递增版本、重打已发布版本或重试上传。`npm pack` / `npm publish --dry-run` 不代表真实发布。

1. 汇总真实源码、验证和版本级变化；若引用正式 Change，只引用 `docs/05-changes/C02-已完成` 中已完成项。Quick 改动不为发布补造 Change 或假归档。
2. 用 `open-spec-mesh new-release VERSION TITLE [--changes "$CHG"]` 创建（Quick 发布可省略 Change） `D01-xx-vX-Y-Z/`，固定包含：
   - `D01-xx-01-release-notes.md`
   - `D01-xx-02-release-checklist.md`
3. Release Notes 只总结版本级用户/系统变化，不复制 Task Delivery。
4. Checklist 按实际发布涉及的 Build、Tests、Configuration、Documentation、Deployment、Rollback 等内容核实，未完成项如实记录。
5. `open-spec-mesh check-release DIRECTORY` 提供文档建议，不能以固定标题或 pass 字样证明真实验证或发布；人为评审决定发布。

真实上传前确认版本未发布、包权限和同一 tarball 的验证；上传后独立核对 registry 的版本与完整性并测试从 registry 安装。认证或发布错误先核对 registry 状态，不盲目重试、不索取聊天中的密钥或验证码。npm 发布不授权其他服务部署、Git push/tag 或 Change 归档，不伪造验证。
