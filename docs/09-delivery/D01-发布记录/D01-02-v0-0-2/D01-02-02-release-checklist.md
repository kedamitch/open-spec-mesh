# 0.0.2 发布检查清单

## Build

- [x] package.json、package-lock.json、npm-shrinkwrap.json 根版本为 0.0.2，两个锁文件字节一致；Node >=22。
- [x] npm tarball 文件清单检查：320 个资源，无用户 Home、依赖树、第一方 Python、诊断归档或常见真实密钥模式。

## Tests

- [x] 自然语言发布授权与 Quick 发布材料定向回归通过。
- [x] Node 22.0.0 与 Node 24 core 均通过 9 项检查（182 个 Node 测试 + 4 个 Agent 测试），含本地/全局 npm consumer smoke。
- full 外部环境验证不列为已通过。

## Database

- [x] 本次无外部业务数据库迁移；历史观测与 Change 不自动清理或改状态。

## Configuration

- 历史检查（2026-09-29）：账户 fatfei 与包维护者匹配；2026-09-30 认证端点为 401，不能继续标记本机身份/发布权限已通过。0.0.2 的实际发布结果仍待核验。
- [x] 接受明确自然语言发布意图与目标版本；仅准备材料或不上传时仍禁止上传。
- [x] 真实 npm 安装与旧 Home 升级通过：12 个技能、5 个角色；旧技能/脚本退出、托管描述更新、用户规则保留、旧技能归档；自然语言发布规则与隐式调用元数据已安装。

## Documentation

- [x] 工作约定、初始化模板、发布技能与公开说明已同步自然语言发布授权。
- [x] 版本级变更与迁移、限制和回退说明已准备；无假归档 Change。
- [x] 文档结构与链接验证通过。

## Deployment

- [ ] 已核验同一 tarball 的真实 public npm 上传。
- [ ] registry 版本、dist-tag、integrity/shasum 与 artifact 核对。
- [ ] 从公共 registry 按包名真实 npm 安装并验证。
- 本文件在打包前准备；上传结果须以发布日志与 registry 结果核实，不以勾选项当成授权或上传证据。

## Rollback

- [x] 0.0.1 保留；不得覆盖历史版本。CLI 回退与 Home 资产恢复独立处理，保全用户修改；不自动 unpublish。

## 真实上传结果

- 2026-09-29T15:24:30.973Z：已按用户明确授权执行一次真实 npm publish，同一已验证 tarball 的上传返回 E403。
- 原因：当前账户 tfa=false，npm 要求 2FA 或具备 bypass 2FA 的 granular access token；本机登录账户 fatfei 与包维护者匹配，但登录不等于满足发布认证。
- 随后独立核对 registry：仅 0.0.1，latest=0.0.1，0.0.2 未发布；公共 registry 安装验证未运行，不标记通过。
- 不盲目重试、不递增到其他版本、不覆盖 0.0.1。用户完成本机认证后，可继续本次明确的 0.0.2 发布授权，无需重新输入技能口令。
- 私有验证与上传日志：/tmp/osm-npm-0.0.2-IQix3M；凭据不进入文档或包。

## 2026-09-30 长期 OIDC 方案

- [x] 本地加入手动 main-only OIDC 发布工作流、同一 artifact 打包/安装/指纹保护和 7 项定向测试；定向测试及 helper 语法检查通过。
- [x] 当前修改后的完整 core：恢复权限并换用 Git 树外 TMPDIR 后，9 项检查通过（189 个 Node + 4 个 Agent 测试及真实 local/global tarball consumer）；原失败保留。
- [x] 用户明确授权后，0.0.2 实际源码及工作流已提交并快进推送至 main（9aad639）；未新增 tag 或更改版本。
- [x] GitHub environment npm 已建立，部署分支限制为 main。
- [ ] npm trusted publisher 绑定 kedamitch/open-spec-mesh / npm-publish.yml / environment npm；本机只读查询仍为 401，待实际 OIDC 验证。
- [x] GitHub-hosted runner 完整 core（最新 191 个 Node + 4 个 Agent，9 项检查）、320 文件实际 artifact 审计、同一 tarball consumer 通过。
- [x] 第二轮 CI artifact 下载后独立核对指纹，本机真实 npm tarball 安装与 Codex host smoke 通过（不是 registry 消费）。
- [ ] npm OIDC exchange / 真实上传：run 36676111203 返回 ENEEDAUTH；只读诊断 run 36676720147 确认 exchange POST 404（package not found），不能取得发布凭据。需核对实际 npm Trusted Publisher 绑定；不盲目重传。
- [ ] 0.0.2 公共 registry consumer：版本未发布，未执行。
- 原本机 tarball 保留；CI 基于实际提交重新打包、验证并上传同一 CI artifact，不伪造与此前 tarball 相同。未再次执行 npm publish。

- 首轮远程 run 36675589841：core 通过，prepare 的 isolated npm 配置重复加载失败；upload 未执行。已修复并补真实 npm 配置加载回归，随后再次验证。

- 最新诊断 run 36676720147 虽然 success，但真实上传步骤被 verify_only 条件跳过；不表示 OIDC 认证或公共发布成功。
