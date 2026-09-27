# 验证规范

## Validation Entry Point

`scripts/sdd_validate.py`

这是 SDD 收口唯一的本地全量验证入口。入口必须被 Git 跟踪并提交到待验证 revision，可直接执行全部 required checks；执行过程中不得改变 HEAD 或项目工件。Main 不再用自然语言声明替代真实运行。

## 验证矩阵

| 层次 | 入口内实际命令 | 检查对象 |
| --- | --- | --- |
| 单元与集成 | `python3 -B -m unittest discover -s tests -v` | Task 身份、恢复、证据、模板、安装、文档结构 |
| 角色约束 | `python3 -B agents/test_validate_agents.py`；`python3 -B agents/validate_agents.py` | GPT-6 模型/effort、V2 配置、角色约束 |
| 文档 | `python3 -B sdd-init/scripts/validate_docs.py --root .` | 编号、Markdown、相对链接与映射 JSON |
| 安装 | `bash -n install.sh`；`bash install.sh --dry-run` | 入口语法、暂存及配置合并 |
| CI 扩展 | `.github/workflows/validate.yml` | Python 3.11/3.13、Mermaid、Docker、Codex V2 runtime、真实 research-tool 安装 smoke |

## 执行层级

- **Worker / Task**：只运行与当前 Task AC 直接相关的定向测试，以及该 Task 必要的 build / static check；不要为每个 Task 重复跑项目全量。
- **Main / Integration**：全部 accepted Task/worktree 集成并同步、提交受影响 Current Truth 后，以该最终 HEAD 执行 `sdd-close/scripts/run_validation.py`。脚本只调用上述单一项目入口，不动态拼 shell 命令。
- **完成条件**：入口内任一 required check 非零即失败；不区分“存量失败 / 新增失败”，不维护 known-failure 白名单。验证后仅 active Change 收口证据可继续变化；其他项目文件变化必须更新 revision 并重跑。CI 扩展仍由仓库工作流独立执行。

## CI 分层与额度控制

- **Pull Request**：只跑 `core (3.11)`，执行同一个 `scripts/sdd_validate.py`；不为每个小提交重复启动兼容矩阵、Mermaid、Docker、Codex runtime、research-tools。
- **main / 手工 full run**：运行 3.11 核心检查、3.13 兼容检查及 Mermaid / Docker / Codex runtime / research-tools 扩展。
- **Laya integration**：只有 Laya、安装器或相关测试/配置发生变化才触发；PR 跑 3.11，main / 手工 full run 再补 3.13。
- **并发**：同一 workflow + PR/ref 只保留最新 run，新的提交自动取消旧 run。
- **原则**：减少重复 runner 消耗，不降低主干最终验证范围；私有仓库 Actions 额度属于账户级资源，不把额度耗尽误判成代码测试失败。

## 执行证据

`run_validation.py` 要求验证 revision 等于执行时的 HEAD，并拒绝 active Change 之外的未提交改动；运行前先使旧成功收据失效。完成后在 Git metadata 下保存 receipt，绑定 Change、revision、验证入口内容摘要、退出码和 stdout/stderr 摘要。归档重新核对这些字段；修改验证入口、换 revision、失败或缺少 receipt 都不能归档。

Change 的验证结果仍写人类可读摘要，但它只用于 Review，不再作为“测试确实跑过”的机器证明。receipt 是防误操作与防陈旧结果机制，不是身份认证或远程证明。

## 边界

确定性 Provider fixture 不调用真实 Sol/Luna，不证明用户网关、模型质量或计费。它验证 `agent_type + fork_turns="none"` 的 V2 模型/effort 透传和 Architect→Explorer 路径；独立进程 fallback 只验证本地 CLI 参数。Docker fixture 不等于业务应用部署；任何运行时工具约束都不是文件级 ACL。
