# 本地工具包运行

## 运行边界

需要 Node.js 22.0.0+、Git、Linux/macOS；Research tools 还需 Node.js 22.0.0+ / npm。Agent host 支持 Codex、OpenCode、Claude Code。本包不是常驻业务应用。

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

单任务/串行由当前 Agent 在当前工作区执行；只有用户确认并行时才启动 Worker/独立 worktree。旧自动 leaf/prepare 已退出，历史会话只用于恢复证据。

## Observation

Codex 支持 full trace。OpenCode / Claude 当前只做 artifact snapshot；数据库使用宿主无关 state home。详见 [行为诊断](../../02-product/P02-modules/P02-04-behavior-observation.md)。

## 验证与恢复

`scripts/sdd_validate.js` 是仓库核心入口；main/full CI 另外安装真实 Codex/OpenCode/Claude CLI 做无模型 runtime smoke。安装失败按受管事务回滚，无法确认归属的用户文件不删除。

## 全局安装与升级

目标公共版本为 0.0.1；发布后优先 npm install -g open-spec-mesh@0.0.1 --registry=https://registry.npmjs.org/，再执行 open-spec-mesh install --host codex --skip-tools。可先追加 --dry-run 预检；全局安装不自动配置 Home。opencode / claude 使用相同命令替换 --host。

未发布或需要源码安装时，在源码目录 npm ci 后执行 npm install -g .；或 npm pack 后 npm install -g ./open-spec-mesh-0.0.1.tgz。源码链接方式需保留源码目录；便携部署使用打包产物。升级全局命令后仍需再次显式 install；npm uninstall -g open-spec-mesh 仅删命令，不删除宿主资产。认证、真实发布与消费验证见 [npm 发布操作](O02-02-npm-publication.md)。

最低 Node 22.0.0 搭配兼容 npm（最低版本验证使用 npm 10）。受管 Skill 整体替换清除旧 Python/缓存；受管 Python MCP 迁移为 Node 并删除旧 helper/cache。未受管内容和自定义 MCP 保留，迁移前备份，不删除用户 Python 环境。
