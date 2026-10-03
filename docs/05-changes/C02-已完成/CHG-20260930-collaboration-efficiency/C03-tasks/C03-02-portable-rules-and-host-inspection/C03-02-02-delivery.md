# C03-02｜通用规则安装与宿主核验交付

## 实际改动

覆盖 B4–B5、C4。workflow-policy.md 为安装通用规则唯一来源；现有必要副本由 sync_workflow.js 生成/检查，根 AGENTS COMMON 标记外内容保全。Codex/OpenCode/Claude 的安装规则与 Main prompt 不再读取根 AGENTS 全文；引用映射到实际宿主目录。

新增按需只读 inspect-host，输出安装文件的模型/effort、包基线比较和版本，不读取 auth 文件或环境变量值，不导出秘密字段或解析器原文，不修改配置。活动会话、优先级覆盖与provider可用性不推断。

## 验证与自审

安装/适配/迁移/运行时与核验定向 44 项通过；后续安装最终回归 19 项通过，检查实际 staged AGENTS 不含项目发布信息且 dispatch 路径有效。既有用户覆盖和资产保全场景保留。修正自审发现的 runtime marker 路径，以真实 home/open-spec-mesh/runtime 为准。

本机只读核验：安装版本 0.0.2；Main 用户覆盖 gpt-6.1-sol/high 保留，五角色文件与包模型基线一致；活动会话仍 unknown，不能据此解释或声称修复此前旧模型派发错误。

## 风险与快照影响

没有升级实际 Home、全局 npm 或修改用户模型。源码能力不等于已发布版本已包含。原 AGENTS 第 7 节与实施前快照逐字节一致。正式 API/Operations Current Truth 在用户确认后最终同步。
