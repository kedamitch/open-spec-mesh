---
name: sdd-migrate
description: 将已有项目的旧 docs 结构安全迁移到当前 01–09 SDD 文档体系；保留旧文档原字节，不猜测语义映射。
---
# 旧项目文档迁移

**执行者**：Main。仅用于已有 `docs/` 与当前 01–09 结构冲突的项目；新项目使用 `sdd-init`。

## 流程

1. 确认当前工作区可提交、旧文档仍是事实来源；不要边改业务代码边迁目录。
2. 运行：

```sh
python3 "$CODEX_HOME/skills/sdd-migrate/scripts/migrate_project.py" --root "$PROJECT"
```

脚本只做结构安全动作：

- 将原 `docs/` 完整移动到 `.sdd-migration/legacy-docs/`，不改原文件内容。
- 创建当前 01–09 canonical scaffold。
- 生成 `docs/01-governance/G02-migration-map.md`，列出每个旧 Markdown 文档。
- 已是 canonical 项目直接拒绝；备份目录已存在时拒绝覆盖。

3. 根据旧文档事实，把内容归入新的 Product / Architecture / Operations / ADR / Research / Change 等单一事实源。**不要按旧编号机械改名，也不要让脚本猜语义。**
4. Migration Map 中每个旧文档都标记真实去向；Current Truth 必须描述当前系统，不复制历史计划。
5. 运行 `sdd-init/scripts/validate_docs.py --root "$PROJECT"`，再人工 Review 导航和关键 Current Truth。未完成映射时，不把迁移说成完成。

旧文档备份默认保留在 `.sdd-migration/legacy-docs/`，由用户在确认新文档事实完整后决定是否删除；技能不会自动销毁历史资料。
