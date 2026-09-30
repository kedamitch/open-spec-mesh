---
name: sdd-init
description: SDD 模式首次接入且需要骨架时的初始化入口；建立 Markdown 文档和图表骨架，不覆盖既有事实，不启动全量写作。
---
# 项目初始化

**执行者**：Main。按用户显式请求或 SDD 工作需要初始化；Quick 不强制初始化。已有旧 docs 与当前 01–09 结构冲突时不要强行 init，改用 `sdd-migrate`。

运行 `node scripts/init_project.js --root <project>`，再运行 `node scripts/validate_docs.js --root <project>`。已存在文件不覆盖，编号冲突先处理；创建其他文档使用 `new_document.js`，规则见 [baselines](references/baselines.md)。

骨架不是已核实快照。不预建模块、业务应用、完整 PRD / Design 链；需要真实事实时只补当前任务依赖的部分。初始化本身不额外调用 Architect；阶段文档由当前 Agent 按授权完成，Architect 仅按需辅助。

结构与信息质量见 [文档契约](references/document-contract.md)，业务应用部署写法见 [运维模板](references/operations-template.md)。返回入口和待核实项，并引导用户按需使用 `$sdd-req 为这个需求创建或完善 Change`。初始化不代表需求已确认，不自动进入设计或实施。
