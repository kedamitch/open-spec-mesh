# Operations Overview

## Environments

| Environment | Purpose |
| --- | --- |
| 开发工作站 | 运行安装器、Codex/OpenCode/Claude Code 与 SDD CLI |
| Host config home | 保存 Open Spec Mesh 受管 Rules / Skills / Agents / overlay |
| 业务项目工作区 | 保存代码、docs 与 SDD Git worktree |
| 外部 Provider | 提供模型推理；不属于本包部署单元 |

## Deployment Architecture

[部署架构图](O03-diagrams/O03-01-deployment-architecture.md)。

本包是按需执行的本地工具集，独立常驻业务应用数为 0。

## Configuration

| Host | 用户配置 | Open Spec Mesh 受管内容 |
| --- | --- | --- |
| Codex | `config.toml` | 受管 role/MCP 合并 |
| OpenCode | `opencode.json(c)` 等 | `AGENTS.md` marker、Skills、Agents、独立 overlay |
| Claude Code | `settings.json` 等 | `CLAUDE.md` marker、Skills、Agents、独立 MCP JSON |

Provider / 工具密钥只通过环境变量继承，不写入仓库或 overlay 值。

## Network

本包无固定监听端口。Research MCP / Provider 网络行为由用户环境决定；runtime smoke 不进行模型调用。

## Observability

- Logs：CLI stderr/stdout、Git、CI。
- Trace：人工确认、宏观 Task、实际 Git diff、验证与 Delivery；旧身份字段仅分析历史。
- Codex native rollout：可做 full observation。
- OpenCode/Claude private trace：当前标记 unsupported/partial，不伪造事件。

## Backup & Recovery

- Git 是代码和正式文档恢复基础。
- 安装器对受管文件使用暂存/替换/回滚。
- 非 Codex 未受管同名资产拒绝覆盖。
- Worker workspace 不自动 reset/rebase；宿主不得创建第二层 worktree。

## Security

- 密钥不写 docs、日志或受管配置值。
- Agent/permission 是宿主安全约束；文档校验是建议，Git diff 与测试结果由当前 Agent 真实核实，不使用自动生命周期门禁。
- 外部 Web/MCP 证据不获得代码写权限。

## Common Operations

[本地工具包运行说明](O02-applications/O02-01-local-toolkit.md)。

## 协作规则维护与检查

修改 canonical sdd-init/references/workflow-policy.md 后使用 npm run sync:workflow 更新必要副本，npm run check:workflow 只读核对。根 AGENTS 受管区域外内容保全；安装读取通用单源，项目专用发布信息不进入下游。

inspect-host 按需核验安全的宿主文件信息，不读取认证值；会话是否重载始终未知。2026-09-30 协作优化仅当前源码实现，包仍0.0.2，没有本次 Home/全局更新或发布。当前已有自定义 Main 保留；文件一致不是活动模型生效证明。

## 2026-10-01 本机安装与默认模型修正

本次Quick优化使用源码受管安装更新Codex Home/runtime，保留用户Main与未受管内容，跳过既有Research工具重装。发现旧default_subagent_model=gpt-5.6-luna；角色TOML一致的既有核验未覆盖此字段，故过去“未发现旧活动配置”不能证明回退无旧值。本次显式迁至gpt-6-luna/max，角色Explorer/Librarian仍low，Worker/Reviewer仍max，Architect不变。文件核验与实际会话行为分别报告，不覆盖历史发布记录。

本轮最终本机global CLI与Codex Home/runtime使用本地源码tgz更新；config/user规则重复安装字节不变，Main保留。真实fresh进程Explorer+同session增量、Main修复/验收通过；当前对话的派发仍指旧值，不能把文件核验或新进程成功当作活动会话热更新。真实探针按需执行，重解析使用--reanalyze不再次推理；本轮没有公共发布。原始证据在/var/tmp/osm-quick-optimization-1A9TnJ。


## 2026-10-01 当前宿主派发恢复（后续复核）

上节“当前对话仍指旧值”记录的是08:24（Asia/Shanghai）时的失败，不是本次复核后的状态。09:18当前同一个Main会话真实新建Explorer，09:20沿用同一Explorer增量继续，09:24真实新建Librarian；三轮子会话context均为gpt-6-luna/low并正常完成。未传model/effort覆盖、未重启daemon、未改Home配置、未使用fresh CLI冒充当前会话。当前daemon PID339641与Main会话01a0f1bb-cb96-76a0-88c4-17063bdc755b保持不变。

根因有两层：旧default_subagent_model未纳入早期角色文件核验，且安装保留自定义值；Codex0.159.3的prepare_agent_spawn_config先用turn.config校验默认模型，再apply_spawn_agent_role，故正确角色TOML不能绕过不在catalog里的旧默认。角色最终模型仍由TOML决定，不在spawn处绕过。对应上游rust-v0.159.3 / commit01fc69f4026735edfdf6789820549727a4867b11的codex-rs/core/src/agent/child_config.rs第62–73、203–224行，已核对版本匹配源码。

当前实际daemon的config/read（含工作区层）返回默认gpt-6-luna/max、Main gpt-6.1-sol/high；默认来源是用户Home，无项目层旧值覆盖。派发使用turn配置快照，不逐次从磁盘重新取默认。08:24失败与09:18成功之间的具体宿主刷新触发事件未捕获，不宣称“下一轮/新建线程一定重载”；现有会话本轮已真实可用，勿为历史旧字串强删记录或中断其他工作。inspect-host仍只报告文件，新增旧默认恢复提示；安装完成提示明确要求实际宿主加载及派发验证，不再承诺新建会话即可生效。私有复核证据见/var/tmp/osm-host-dispatch-vg4pgf。
