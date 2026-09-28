# 验证规范

## Validation Entry Point

`{"argv":["node","scripts/sdd_validate.js","--profile","full"],"path":"scripts/sdd_validate.js"}`

本仓库使用版本化 Node 入口。Worker 可定向运行 `node scripts/sdd_validate.js --profile core`；Main 最终验证使用上面的 revision-bound full argv。

SDD 收口记录必须绑定实际执行时的 HEAD；required check 任一非零即失败，不允许“未执行但通过”。Core 是 Node-only 消费验证；完整项目验证还需要系统级 Git、宿主 CLI 与测试工具。Python 不是消费端运行依赖，只保留在显式的 GPU factory lane 和 Docker 应用 fixture 中。

## 验证矩阵

| 层次 | 入口 / Job | 检查对象 |
| --- | --- | --- |
| Node 回归 | `node --test <tests/node/**/*.test.js>` | 已迁移平台行为、异常路径与本地 fixture |
| 角色约束 | `node agents/validate_agents.js` + `node --test agents/test_validate_agents.js` | canonical Codex Role/model/effort、职责、delegate 与 V2 tool 配置 |
| 迁移覆盖 | `node scripts/verify_coverage.js` | 固定 baseline 的逐方法 Node/GPU 映射和 intentional behavior replacement |
| 运行时静态 | `node scripts/check_runtime.js` | syntax、Node-only source/package、完整 tgz packlist、release lock、root ignore 与保全 fixture |
| 文档 | `node bin/open-spec-mesh.js validate-docs --root .` | 编号、Markdown、链接、coverage/schema |
| 安装 | `bash -n install.sh`；`bash install.sh --dry-run` | Node CLI 与受管文件事务的无写 dry-run |
| Tarball 消费 | `node scripts/verify_tarball.js` | 隔离 npm cache/Home、临时安装、文档→SDD→SQLite→ZIP→MCP SDK consumer 路径 |
| Codex runtime | `node scripts/verify_codex.js` | 真实 Codex V2 role routing fixture，无模型请求 |
| OpenCode runtime | `node scripts/verify_opencode.js` | 真实 CLI 解析 native config/agents/launcher flags，无模型调用 |
| Claude runtime | `node scripts/verify_claude.js` | 真实 CLI 校验 agent/frontmatter/launcher flags，无模型调用 |
| 其他扩展 | `render_mermaid.js` / `verify_docker.js` / `verify_research_tools.js` / `verify_laya.js` | Mermaid、Docker fixture、真实 npm tools 与 Node MCP client |
| 独立 GPU lane | `python3 -B -m unittest discover -s tests -p 'test_laya_server.py' -v` | GPU factory/helper/API 安全与批量调用；不声称真实 CUDA 推理 |

## 执行层级

- Worker：当前 Task 定向测试 + 必要 build/static check；不重复跑全项目。
- Main：全部 accepted result 集成、Architect 同步 Current Truth 后执行 revision-bound full validation。
- 完成条件：任何失败都修到通过，不维护 known-failure / baseline-failure 豁免。

## CI 分层

- Pull Request：Node.js 24.21.0+ core 与 isolated tarball smoke。
- `main` / manual full：同一 core + Mermaid + Docker + Codex + OpenCode + Claude + Research tools + Node MCP + 独立 GPU factory lane。
- 同 workflow/ref 只保留最新 run。

## 发行与安全边界

发布前本地 tarball 必须携带 `npm-shrinkwrap.json`，且与唯一开发来源 `package-lock.json` 原字节一致。开发锁、依赖解析树和 package identity 不因验证改变；`private=true` 时只允许本地 artifact 验证，不公开 publish。

根 `/node_modules/` 只由根 `.gitignore` 忽略；嵌套同名目录不扩大忽略。保全测试只在临时 Git/Home fixture 创建哨兵，绝不在真实根依赖目录写测试数据。

## 证据边界

Codex fixture 验证 V2 tool/role 配置但不证明模型质量。OpenCode/Claude jobs 使用真实 CLI，只验证安装产物、frontmatter/config 解析与当前 CLI flags；不会登录、发送 prompt 或产生模型费用。Research smoke 验证实际 npm package/CLI 安装但不做认证请求。GPU lane 只验证 factory/API 协议与 guard，不表示真实推理服务已部署。
