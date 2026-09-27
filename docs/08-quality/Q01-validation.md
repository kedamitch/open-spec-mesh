# 验证规范

## Validation Entry Point

`scripts/sdd_validate.py`

SDD 收口只使用上述版本化 Python 入口。验证 revision 必须等于执行时 HEAD；任何 required check 非零即失败。

## 验证矩阵

| 层次 | 入口 / Job | 检查对象 |
| --- | --- | --- |
| 单元与集成 | `python3 -B -m unittest discover -s tests -v` | SDD runtime、Adapter、安装、Delivery、Observation |
| 角色约束 | agent validators | canonical Codex Role/model/effort 与职责 |
| 文档 | `validate_docs.py` | 编号、Markdown、链接、映射 |
| 安装 | `bash -n install.sh`；dry-run | CLI 与受管文件事务 |
| Codex runtime | `verify_codex.py` | 真实 Codex V2 role routing fixture |
| OpenCode runtime | `verify_opencode.py` | 最新真实 CLI 解析 native config/agents/launcher flags；无模型调用 |
| Claude runtime | `verify_claude.py` | 最新真实 CLI 校验 agent frontmatter/launcher flags；无模型调用 |
| 其他扩展 | Mermaid / Docker / research-tools | 图、fixture、真实 npm tool smoke |

## 执行层级

- Worker：当前 Task 定向测试 + 必要 build/static check。
- Main：全部 accepted result 集成、Architect 同步 Current Truth 后执行 revision-bound full validation。
- 完成条件：任何失败都修到通过，不维护 known-failure / baseline-failure 豁免。

## CI 分层

- Pull Request：默认只跑 core 3.11；避免每个小提交重复安装外部 runtime。
- `main` / manual full：core + Python 3.13 + Mermaid + Docker + Codex + OpenCode + Claude + research-tools。
- `integration/**` push：用于合 main 前显式运行真实 host runtime smoke；不执行模型请求。
- 同 workflow/ref 只保留最新 run。

## 证据边界

Codex fixture 验证 V2 tool/role 配置但不证明模型质量。OpenCode/Claude jobs 使用真实最新版 CLI，只验证安装产物、frontmatter/config 解析与当前 CLI flags；不会登录、发送 prompt 或产生模型费用。Provider 认证仍属于用户环境。
