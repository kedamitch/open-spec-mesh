# C03-03｜文档与包元数据交付

## 实际改动

- `package.json`：新增顶层 `engines.dsh = ">=0.2.1-rc.4"`（`:9`，宿主实际读取点见 `dsh-app-boot/lib/index.js:279-284`、`:311-314`；`dsh.engines.dsh` 在 DSH 全树无读者，是社区插件 dsh-liangshen 的写法）；`exports` 增加 `"./package.json"`（`:23`），删除死配置 `"./dsh/locale/*"`；`files` 删除已无匹配的 `"dsh/**/*.json"`。未加 `@deepseek-ai/dsh` 的 peerDependencies。
- 删除 `dsh/locale/en.json`、`dsh/locale/zh.json`（全仓无代码引用）。
- `README.md`、`README.zh-CN.md`：版本口径 0.0.1 → 0.1.0；删除"0.0.1 仍用 open-spec-mesh、osm 只有本地源码"的失真表述；新增/重写 DSH 章节（`dsh plugin --profile <p> add open-spec-mesh`、预设名 `sdd`、`engines.dsh >= 0.2.1-rc.4` 及原因、`osm install --host dsh` 写什么/不写什么、角色路由与 allowlist 由宿主校验）；`:180` 标题改为 `Collaboration efficiency (shipped since 0.0.3)`（已发布 tarball 0.0.3 与 0.1.0 均含 `sdd-init/references/collaboration-guide.md`），`:197` 的 0.0.2 断言改为当前口径。
- `docs/02-product/P02-modules/P02-03-installation.md`：Host 表新增 DSH 行，功能表新增 `--host dsh` 与 `dsh plugin` 两行，新增 `## DeepSeek Harness (DSH)` 小节。

## 验证与自审

- `node scripts/check_runtime.js`：`Runtime audit passed: syntax=143, Python-sources=0, package-files=367, lock=3, static-files=92`；删除两个 locale 文件前该计数为 369，减少量与删除文件数一致。
- 自审要点：没有把"挂载成功"写成"运行生效"；没有把未跑通的安装器全流程写成通过；版本号未改动（仍是 0.1.0）。

## 风险与快照影响

README 的 DSH 章节描述的是 A/B 两段已落地的行为，但真实会话中的运行时效果未观察，因此文档只写到"挂载与组合"这一层。此 Delivery 是事实记录，不是人工验收。
