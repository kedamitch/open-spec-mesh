---
name: sdd-release
description: 基于已完成 Change 生成版本级 Release Notes 与 Release Checklist；不代替真实部署。
---
# 版本发布

1. 只引用 `docs/05-changes/C02-已完成` 中已完成 Change。
2. 用 `new_release.py` 创建 `D01-xx-vX-Y-Z/`，固定包含：
   - `D01-xx-01-release-notes.md`
   - `D01-xx-02-release-checklist.md`
3. Release Notes 只总结版本级用户/系统变化，不复制 Task Delivery。
4. Checklist 必须逐项确认 Build、Tests、Database、Configuration、Documentation、Deployment、Rollback。
5. 只有 Release Notes 最终结论为 `pass` 且 Checklist 无未勾选项时，`check_release.py` 才通过。

本 Skill 不自动部署、不伪造验证、不把归档等同于上线。
