# Open Spec Mesh 0.0.3 发布说明

## 版本

- Version：0.0.3。
- 发布日期：2026-10-03；registry时间2026-10-03T07:57:54.916Z，发布源码cc7d79909ce729f5749e19f338f8fba88884bd84。

## Highlights

- 降低多Agent交接与返工开销：已知小任务由Main连续完成，不机械调用Architect、Worker或Reviewer。
- 新目标默认Quick；连续执行不等于SDD，保留文档结构不等于每次生成完整工件。
- 修复旧默认子代理模型的漏检和迁移问题，并兼容Codex原生V2的task-name派发及同session续用观测。

## Changes

### Added

- inspect-host只读核验受管角色、Main与默认子代理模型；输出明确区分安装文件与未知运行时状态。
- 显式--migrate-legacy-agent-defaults仅迁移旧gpt-5.6-luna默认值，保留Main、任意其他自定义模型和effort。
- evaluate-collaboration提供可读或JSON评估与显式strict检查；不足证据保留unknown，不自动调用模型或构成验收。
- 公共workflow-policy单源及sync:workflow/check:workflow，避免项目专用发布约定传播到下游。
- 单任务SDD短写参考与可选真实模型验证helper；只有显式--run可能产生推理费用，--reanalyze复用已记录证据。

### Changed

- Quick不创建正式Change/Task/Delivery链，也不为交付调用sdd-close；按需要更新已有Current Truth或明确要求的报告。
- 整体设计与任务设计保持宏观，区分硬约束、可调整方案和待验证假设；执行者自主完成普通修复，仅协调真正受影响的公共契约。
- 串行由Main实施；只有明确授权并行写时才派发Worker并使用独立worktree。独立Reviewer仍须明确请求。
- 实际Current Truth随实施同步，人工验收另记；明确覆盖实现与最终交付的授权可一次close，不强制两轮确认。
- 安装完成提示明确只更新文件；新建线程不作为运行时配置已生效的保证。

### Fixed

- 角色TOML正确但旧default_subagent_model仍阻断派发：Codex0.159.3先校验默认再加载角色，因此核验不能遗漏默认字段。
- V2派发返回task_name时无法关联实际子会话；仅在父UUID、角色、别名唯一匹配时链接，不猜测模糊身份。
- 新world_state/token_usage_record/inter-agent元数据解析与累计usage边界；不复制对话或思维过程，不重复计算用量。
- 旧自动生命周期提示词残留、Quick模式继承及过度文档要求。

### Removed

- 本版本不删除既有docs/01–09、Change/Task/Delivery结构或历史证据，不恢复自动Graph/attempt/receipt生命周期。

## Breaking Changes

- 相比0.0.2未主动删除CLI公共入口；新默认工作边界以Quick为准，SDD仍由用户明确选择或继续既有Change。

## Migration

1. 执行npm install -g open-spec-mesh@0.0.3 --registry=https://registry.npmjs.org/。
2. 执行open-spec-mesh install --host codex --skip-tools；其他宿主替换host。
3. 若inspect-host报告旧默认，明确授权后对同一Home执行open-spec-mesh install --host codex --skip-tools --migrate-legacy-agent-defaults。此参数只适用于Codex，不迁移其他自定义值。
4. 在实际宿主加载新配置，并按需要核验真实configured agent_type派发及子会话模型；不覆盖spawn模型、不自动重启其他活动会话。

## Related Changes

- 已完成协作效率优化：[CHG-20260930-collaboration-efficiency](../../../05-changes/C02-已完成/CHG-20260930-collaboration-efficiency/index.md)。
- 其余Quick增量按真实源码和验证证据汇总，不为发布伪造完成或归档正在进行的评估Change。

## Known Issues

- inspect-host只核安装文件，不解析活动会话、供应商可用性或认证；文件一致不是实际模型生效证明。
- 2026-10-01当前会话Explorer新建/续用和Librarian新建已真实通过；具体刷新触发事件未捕获，不承诺所有旧会话自动恢复。
- 已知小任务的单次真实对照不支持普遍金额节省结论；真实Worker并行写与所有外部宿主质量未验证。
- core不等于full外部环境验证；真实推理helper不是默认安装、验证或日常派发前置。

## Rollback Notes

可显式安装open-spec-mesh@0.0.2回退CLI；Home技能与配置是独立资产，回退前保全当前内容，不自动恢复旧模型、不删除历史、不unpublish已发布版本或改动其他dist-tag。

## 发布状态

已通过OIDC真实上传，latest=0.0.3；公开tgz与已验证CI产物字节一致，独立公开consumer与本机更新通过。原run因最终传播核验超时标红，失败记录与后续核验详见检查清单，未再次上传。
