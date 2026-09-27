# 本地工具包运行

## 运行边界

需要 Python 3.11+、Git、Linux/macOS；Research tools 还需 Node.js 20.18.1+ / npm。Agent host 支持 Codex、OpenCode、Claude Code。本包不是常驻业务应用。

## 安装

```sh
# Codex，保持默认
./install.sh --dry-run
./install.sh

# OpenCode
./install.sh --host opencode

# Claude Code
./install.sh --host claude
```

可用 `--host-home` 指定目标配置根。Codex 继续支持 `--codex-home` 兼容参数。

### 启动 Main

```sh
# OpenCode：加载 package-owned MCP overlay
OPENCODE_CONFIG="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/open-spec-mesh.opencode.json" \
  opencode --agent main

# Claude Code
claude --agent main \
  --mcp-config "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/open-spec-mesh.mcp.json"
```

Codex 继续使用现有配置角色启动方式。

## 受管边界

- Codex：沿用原 config merge / migration。
- OpenCode / Claude：不解析或重写用户 model/provider/plugins/settings；只管理自己声明的 Rules marker、Skills、Agents、manifest 和 overlay。
- 同名未受管 Skill/Agent/overlay 存在时拒绝覆盖。
- Research tool 密钥只检查环境变量是否存在，不回显、不写值。
- `--skip-tools` 允许只安装 runtime，但不宣称 Research MCP 已可用。
- 非 Codex `--with-laya` 当前 fail closed；不要生成半套 System One 配置。

## Worker / Session

叶子执行见 [leaf-execution](../../../sdd-do/references/leaf-execution.md)。三宿主都必须在 `sdd.py prepare` 返回的 workspace 中执行，恢复使用绑定的 exact session ID，不使用宿主自动 worktree。

## Observation

Codex 支持 full trace。OpenCode / Claude 当前只做 artifact snapshot；数据库使用宿主无关 state home。详见 [行为诊断](../../02-product/P02-modules/P02-04-behavior-observation.md)。

## 验证与恢复

`scripts/sdd_validate.py` 是仓库核心入口；main/full CI 另外安装真实 Codex/OpenCode/Claude CLI 做无模型 runtime smoke。安装失败按受管事务回滚，无法确认归属的用户文件不删除。
