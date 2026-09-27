# 本地工具包运行

## 运行边界

需要 Python 3.11+、Git、Linux/macOS；自动安装研究工具还需 Node.js 20.18.1+ / npm，各最新版引擎约束由 npm 校验。源码与 Codex Home 分离。本包不是常驻业务应用，Dockerfile 和应用 `.env` 不适用。Docker CI 仅运行 [测试夹具](../../../tests/fixtures/docker-app/Dockerfile)。

## 安装与启动

在本地安全设置并导出 `CONTEXT7_API_KEY`、`TAVILY_API_KEY` 后，在源码仓库根目录执行：

```sh
./install.sh --dry-run
./install.sh
```

- **目标**：默认 `$CODEX_HOME` 或 `~/.codex`，可指定 `--codex-home`；安装后在能继承密钥变量的环境中开启新会话。
- **运行内容**：默认安装技能、角色、必要参考及自动生成的精简导航；不复制本包 docs 历史。
- **已有资料**：默认保留目标 docs。需要完整参考资料才用 `--include-project-docs`，该模式会替换目标 docs，不应用于业务文档目录。
- **研究工具**：缺失时安装 npm 最新版到 `CODEX_HOME/.open-spec-mesh-tools/<工具名>/`。CodeGraph 使用 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)，实际命令为 `codegraph serve --mcp`。
- **修复旧版**：正式安装迁移已识别的错误默认配置；`--skip-tools` 不执行迁移。保留旧包文件、自定义和禁用配置，不对全局包执行卸载。

日常操作统一使用 [三动作运行指南](../../../sdd-init/references/runtime-guide.md)；业务目录用 `--root` 指定，旧 CLI 仍可用。

## 密钥与配置

| 检查 | 行为 |
| --- | --- |
| 正式安装 | 两个变量均须非空；缺失或空白时在工具下载和目标配置写入前停止 |
| dry-run | 报告变量状态和计划，不改目标；返回预览成功不代表工具就绪 |
| skip-tools | 仍报告缺失，允许只更新运行配置；不修复 CodeGraph、不宣称环境可用 |
| 运行透传 | 只写 MCP env_vars 中的变量名；现有 STDIO 配置补齐透传，HTTP/自定义认证不覆盖 |
| 安全边界 | 不回显/保存值，不 source shell 配置或自动读 `.env`，不把服务密钥交给 npm，不做认证请求 |

Provider/MCP、凭据、业务仓库路径属于用户环境。安装保留非受管配置和已有并发设置；实际服务认证与运行时变量继承仍须在用户环境验证。叶子隔离与 thread 恢复见 [leaf-execution](../../../sdd-do/references/leaf-execution.md)。

安装不调用上游 `codegraph install`，避免改写其他客户端规则；不自动初始化业务仓库索引。需要索引时，在业务仓库使用 config.toml 中的实际 CodeGraph 命令执行 `init`。

## 验证与恢复

运行 [验证规范](../../08-quality/Q01-validation.md)。SDD 最终收口通过 `sdd-close/scripts/run_validation.py` 调用项目版本化 Validation Entry Point，并将结果绑定最终 revision；receipt 不含密钥和原始测试输出。升级清理仅作用于包清单和已验证历史规则；无法确认归属的文本保留。

配置与技能先暂存，再记录实际移动路径；捕获失败后恢复，恢复不完整则保留恢复目录并报错。成功后的临时清理失败仅警告。研究工具安装是独立步骤，不属于配置事务的完整回滚范围。

清单兼容旧 `.open-spec-mesh.install.json`，使用 `.open-spec-mesh-managed.json` 保存当前项。CI 的研究工具检查安装真实 npm 包并验证 CodeGraph CLI，使用无效测试占位值，不调用 Tavily/Context7 认证 API。

回退须选择已知兼容源码提交并重新安装；先核对活动 Task 协议，不能删除工作区或覆盖冻结摘要消除错误。未经验证的跨版本回退不得标记成功。

## Laya 启停与外部服务

安装器默认支持 Laya，`--without-laya` 关闭工具、适配技能与提示，不停止 GPU 服务；新会话刷新已加载提示。纯本地紧急关闭可组合 `--skip-tools`，不依赖任何 Laya 环境变量。

GPU 服务可用仓库 mcp/laya_batch_server.py 替换旧入口，复用已配置的 Laya 虚拟环境，默认 multilingual、严格 TileLang、单进程并发门控。客户端默认调用 `/v1/systemone/batch`，单条也走该接口；不需要路径变量或重新安装 CUDA。服务端 JIT、设备兼容和性能需在实际 GPU 上验收，协议 CI 不替代该验收。
