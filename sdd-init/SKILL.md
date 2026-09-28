---
name: sdd-init
description: 正式 Change 首次接入时建立 Markdown 文档和图表骨架；不覆盖既有事实，不启动全量写作。
---
# 项目初始化

**执行者**：Main。Quick 不初始化；进入 SDD 且项目没有 docs 时使用。已有旧 docs 与当前 01–09 结构冲突时不要强行 init，改用 `sdd-migrate`。

运行 `node scripts/init_project.js --root <project>`，再运行 `node scripts/validate_docs.js --root <project>`。已存在文件不覆盖，编号冲突先处理；创建其他文档使用 `new_document.js`，规则见 [baselines](references/baselines.md)。

骨架不是已核实快照。不预建模块、业务应用、完整 PRD / Design 链；需要真实事实时只补当前任务依赖的部分。初始化本身不额外调用 Architect；SDD 规划仍由 Architect 负责。

结构与信息质量见 [文档契约](references/document-contract.md)，业务应用部署写法见 [运维模板](references/operations-template.md)。返回入口和待核实项，不自动进入实施。
