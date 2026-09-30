# Open Spec Mesh 0.0.2 发布说明

## 版本

- Version：0.0.2。
- Release Date：2026-09-30；registry 版本记录时间 2026-09-30T08:34:06.836Z，发布材料最初准备于 2026-09-29。

## Highlights

- 执行模式统一为 Quick / 人工推动的 SDD，阶段为需求、整体设计、执行计划、实现、交付。
- 将宽泛的 sdd-change 拆分为 sdd-req、sdd-design、sdd-plan；执行计划包含任务拆分与任务级宏观设计。
- “发布 0.0.2”等明确自然语言指令自动使用 sdd-release 并授权该目标版本的 npm 上传，无需用户重复输入技能口令。

## Changes

### Added

- 手动指定版本的 GitHub Actions OIDC 发布流程：同一 tarball 的审计、安装、指纹核对及公共 registry 验证；无需长期 npm 写入 token。
- osm 短入口：无参数执行 Codex + skip-tools 安装，保留完整子命令与 dry-run。
- 阶段对应的技能引导、Node.js 第一方实现与锁定依赖的独立 Home runtime。
- Quick 发布材料可不绑定正式 Change；若提供 Change 引用，仍检查其已完成且不重复。

### Changed

- Architect 模型更新为 gpt-6.1-sol，保持 xhigh；配置校验与原生 Codex 测试 catalog 同步，其他角色模型不变。
- 串行实现由当前 Agent 连续完成；只有用户确认并行实现时使用 Worker 与独立 worktree。
- 安装升级同步受管技能、角色提示词及 config.toml 中受管角色的选择描述，保留用户自定义配置。
- sdd-release 支持隐式技能选择；仅准备材料、不上传等限制仍有效。

### Fixed

- 升级时遗留旧角色描述导致角色选择仍受旧 Task Graph 提示词影响。
- 旧受管技能含本地修改时先私有归档，再退出技能发现；未受管目录不按名称删除。

### Removed

- sdd-change 与 sdd-requirements 活动技能，以及旧 sdd-change/scripts 入口。
- 自动 SDD 生命周期命令、机器执行 Graph 门禁与第一方 Python 实现。

## Breaking Changes

- 旧自动生命周期命令不再可执行；历史材料与旧记录识别不控制新流程。
- 使用 sdd-req / sdd-design / sdd-plan 替代 sdd-change；CLI 文档辅助命令仍路由到新的实现。

## Migration

1. npm install -g open-spec-mesh@0.0.2 --registry=https://registry.npmjs.org/。
2. open-spec-mesh install --host codex --skip-tools；其他宿主替换 host。
3. 新开宿主会话加载技能和指令；旧受管技能恢复档案位于 Home 的 open-spec-mesh/retired-skills/。

## Related Changes

本次包含 Quick 实现与已存在的源码改动，依据真实源码、安装审计及验证记录总结；不为发布创建或伪造完成/归档的 Change。

## Known Issues

- --skip-tools 不验证外部 MCP 的认证、连通性或推理服务；core 不代表 full 外部集成验证。
- 历史识别和迁移代码保留旧名称，semi-auto 输入归一化为 sdd，不恢复旧执行入口。

## Rollback Notes

如需回退 npm CLI，可显式安装 0.0.1；Home 规则与技能是独立资产，回退需保全现状并按历史备份处理，不自动清除用户修改或私有归档。不自动 unpublish、重发已发布版本或更改其他 dist-tag。
