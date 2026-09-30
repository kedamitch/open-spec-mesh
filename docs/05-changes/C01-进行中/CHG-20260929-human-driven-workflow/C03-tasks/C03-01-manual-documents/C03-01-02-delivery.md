# C03-01｜人工流程与渐进文档：实施记录

> 2026-09-29，当前 Agent 按用户明确授权串行实施；已实现并通过相应 Node 回归，待用户确认。不是整项迁移验收。

## 实际结果

- Quick 默认由当前 Agent 连续完成；陌生本地调用链优先 Explorer，外部当前事实优先 Librarian，已有证据不重复遍历。
- 半自动为需求 → 设计 → 任务拆分 → 实现 → 交付；每阶段人工确认，明确的跨阶段授权可连续执行。去掉强制 Architect、整图冻结、文件/函数清单和实现细节门禁。
- 当前 Agent 在单任务/串行中直接实现；仅经授权的并行写任务使用 Worker 与独立 worktree。Worker 可自主调整必要文件、内部结构和测试；实质目标/验收/安全/公共方案变化才请用户决定。
- 新代理 task_name / 可控标题采用 role_desc。新增验证函数检查实际角色前缀与 lowercase snake_case；configured role IDs、模型/effort 和历史 session 不改名。
- new-change 只创建需求与导航；ensure-design 显式增补整体设计；new-task 保存宏观 Task 与 Markdown 任务计划，不创建 Graph 或空 Delivery。锁、路径安全和回滚保留。
- 文档格式/结构/链接检查输出建议，不代表阶段授权；真实安全与 I/O 错误不被放宽。

## 验证与局部修复

Node.js 24.21.0：document-tooling、agent 配置/命名及 guidance 回归通过，最终整套 Node 结果见 C03-04 实施记录。validate-docs 实际输出 docs: valid。

直接运行 Skill 脚本的验证发现旧入口 guard 使用被导入模块的 URL，曾出现无执行却 exit=0；补齐 caller import.meta.url 并避免入口重新动态导入自身导致未完成的 top-level await。新增实际子进程 --help 与 validate-docs 回归，8 项 runtime CLI 回归通过。不以脚本零退出代替真实执行。

## 自审与文档影响

角色 canonical source 仍为 TOML，Markdown 由 Host Adapter 生成，不引入第二套角色源。规则、项目 AGENTS 模板、相关 Skills、文档合同和宏观模板同步；未安装到用户全局 Skill 根。需求与设计限定可验收能力，路径不是授权白名单。

## 剩余边界

完整 Node.js 迁移仍包含 GPU 服务，未因此缩减范围；本 Task 结果不能替代 GPU 决定或最终人工验收。

## 2026-09-29 后续：GPU 退出已确认

本记录正文保留 GPU 授权前的实现结果、未决项及失败证据。用户后续已明确允许删除自托管 GPU，服务与专属 Python 测试/CI/依赖现已退出；最新核心完整验证 exit=0，9 项检查与 163 项 Node/Agent 回归通过，Python=0。最新事实见 [C03-05 实施结果](../C03-05-node-gpu-service/C03-05-03-delivery.md)。此前 core 失败不再是当前结果；扩展验证尚未全绿，不把核心通过当作最终人工验收。
