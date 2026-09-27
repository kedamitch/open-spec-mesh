# 适配来源

来源：[typesafe-ai/skills](https://github.com/typesafe-ai/skills)，上游 `skills/typesafe-ai/SKILL.md`，核对提交 `65a39f393687675ce170e6094757de20370365b9`，MIT。核对的是上游，不宣称读取了用户机器上的安装副本。

保留：从目标反推小判断、state / instructions / criteria 分离、独立问题组合、typed output 不等于事实、基于本域数据验证。

调整：面向重复判断，一次设计、固定模板执行；使用本仓库 Laya MCP，不使用 TypeSafe API/SDK，不引入 Jev 或额外密钥，不要求每次本地判断重新查在线文档。

已有 `typesafe-ai` 保持原状，包括其符号链接、内容与配置。仅新增本包拥有的 `typesafe-laya`；关闭后撤下适配技能与运行提示。MIT 许可随本技能分发。
