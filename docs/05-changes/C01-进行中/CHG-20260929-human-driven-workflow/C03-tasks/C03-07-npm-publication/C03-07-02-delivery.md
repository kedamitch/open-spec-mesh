# 公共 npm 0.0.1：发布准备与认证阻塞

> 2026-09-29，用户已明确授权当前 Agent 串行真实发布及安装文档更新。**发布准备已完成，实际公共上传尚未完成**；不把此记录当成实现验收、归档或 registry 成功。

## 本轮真实改动

- package.json、package-lock、npm-shrinkwrap 根版本统一为 0.0.1，锁仍字节相同；全部 dependency 与 transitive lock 数据保持原样。
- public publishConfig 固定 https://registry.npmjs.org/，保留 Node >=22.0.0 / bin / 无宿主 postinstall；补充来源仓库、首页、问题入口与关键词。
- 双语 README 优先固定版本公共 npm 命令，明确 npm 全局安装与显式宿主配置是两步；补齐三宿主/custom Home、npm exec、源码/tarball、升级/卸载、PATH/权限与旧脚本退役边界。
- 安装模块、运行指南、工具指南与独立 npm 发布指南同步；公共命令只适用于真正发布后，不将 E404 解释为已安装。
- 未改本机已安装旧版本 Home，未提交/push/tag/归档，未换角色模型或委派 Worker。

## 验证证据

- Node 22.0.0 + npm 10.9.2 core exit=0，9 项 required checks 全通过；160 项项目 + 4 项 Agent 回归共 164 项，零失败/skip。实际 consumer tarball、npm 全局 bin、源码目录全局链接、Skill/MCP 入口均按 0.0.1 验证。
- CLI --version 输出 0.0.1；两份锁 byte-identical；依赖/传递锁不漂移。
- npm pack 生成 open-spec-mesh-0.0.1.tgz；实际文件清单无 Python、用户配置凭据、.npmrc、.env、测试、node_modules、会话、ZIP/数据库/日志。常见私钥/npm/GitHub/provider/AWS token 模式检查未发现匹配；这不是对任意形式秘密的绝对证明。
- npm publish tarball --access public --registry=https://registry.npmjs.org/ --dry-run exit=0，明确标注 dry-run 且警告需登录；没有将这条命令作为真实上传。
- full 扩展环境未重新完成，不能声称全绿。旧 0.1.0 本地证据保持原历史语义，不改写为 0.0.1 公共消费。

日志、私有本轮前备份和待发布产物位于 /tmp/osm-npm-0.0.1-eMNZEW；待认证后重新核对并使用准备目录中的同一经检查 tarball 发布。产物 metadata/integrity 保存在目录内 pack.json，不能用上传前元数据充当 registry receipt。

## 实际阻塞及后续动作

npm whoami --registry=https://registry.npmjs.org/ 返回 ENEEDAUTH；公共包查询返回 E404；没有可用 NPM_TOKEN / NODE_AUTH_TOKEN。当前不能证明账户权限，更不能声称公开可安装。

用户需在本机终端 npm login --registry=https://registry.npmjs.org/ 并完成 npm 要求的浏览器/双因素流程，不在聊天提供密码/token/验证码。认证后当前 Agent 核对包名/版本权限、发布 0.0.1 public，再比对 registry version/integrity/shasum，并隔离按包名安装验证。若遇权限/OTP/版本冲突仍如实处理，不重复改版或私自变更包名。

## 2026-09-29 用户报告登录后的续发尝试

用户已报告 npm 登录成功并授权继续上传。当前会话已变为 workspace-write、network restricted、approval never；不请求提权或绕过隔离。

已在本地核对准备的 tarball 与 pack.json 的 version、SHA-1、SHA-512 integrity 均一致，版本为 open-spec-mesh@0.0.1。将 npm cache/logs 放到允许写入的 /tmp 准备目录，避免写用户 Home。

npm whoami 与 npm view 均在请求阶段失败：connect EPERM 127.0.0.1:1086，本机代理连接被当前运行环境拒绝。此错误不能证明用户登录失败；认证状态未能在线核对。未发送 npm publish 上传请求，也未完成 registry 按名消费验证。公开 registry 的额外只读查询也未取得可用结果。

当前阻塞已从早先的未登录转为本会话网络权限。用户可在自己的已登录、可联网终端执行 npm publish /tmp/osm-npm-0.0.1-eMNZEW/open-spec-mesh-0.0.1.tgz --access public --registry=https://registry.npmjs.org/，按 npm 本机提示完成必要验证；不得把密码、token、OTP 或登录授权链接发到聊天。上传后仍需 npm view 核对版本/integrity 和按 registry 包名安装验证，不能把当前本地哈希或此前 dry-run 当成真实发布证明。

现有待发布 tarball 未改动；本段是源仓库后续操作记录，不冒称已包含于该历史打包快照。未提交、推送或归档。

## 2026-09-29 网络权限恢复后的真实发布尝试

用户恢复网络/文件权限并授权继续。准备 tarball 的 SHA-1、SHA-512 integrity 与 pack.json 再核对一致，未替换或重打包。npm whoami 成功，目标包查询 E404。

已真实执行 npm publish prepared-tarball --access public --tag latest --registry=https://registry.npmjs.org/；退出码 1，registry PUT 返回 E403：Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages。随后目标 0.0.1 查询仍为 E404，未取得公开发布记录。认证可用与满足发布安全要求是两回事，未将此前 ENEEDAUTH/EPERM、当前 E403 或 dry-run 混写。

当前剩余阻塞为 npm 账户发布安全要求。当前 Agent 不自动关闭/变更双因素设置、不创建 bypass token，也不在聊天索取密码、token、OTP 或授权链接。用户需在自己设备启用并完成 2FA，或自行配置具备必要发布权限及 bypass 2FA 的 granular token；处理后再执行真实上传、registry integrity 与按包名消费验证。

真实上传 stdout/stderr/exit 记录保存在准备目录的 publish.stdout、publish.stderr、publish.exit，权限私有。账户 profile 仅在内存中读取用于确认安全状态，没有持久保存完整 profile 或回显其他账户字段。未提交/push/tag/归档；prepared artifact 仍未修改，本段是后续源仓库记录而非该历史 tarball 的内容。

## 2026-09-29 0.0.1 实际发布成功

在用户完成凭据配置并要求继续后，使用专用 npm userconfig 上传已验证 tarball，exit=0，返回 + open-spec-mesh@0.0.1。registry 发布时间 2026-09-29T09:49:44.527Z（北京时间 2026-09-29 17:49:44），latest=0.0.1；registry SHA-1 和 SHA-512 integrity 与冻结的本地产物逐项相同。

使用 Node 22.0.0、全新 HOME/cache、空 user/global npm 配置、无 npm 认证，从公共 registry 按包名安装成功；global --version 输出 0.0.1，--help 和含空格 project 初始化/校验通过。Codex/OpenCode/Claude 的 --skip-tools dry-run、真实受管配置安装与已安装 Skill --help 均通过，不冒称宿主应用或外部推理服务启动测试。凭据未输出、未复制到隔离消费者、未进入仓库或包。完整 receipt/log 保存在准备目录。

0.0.1 是已发布不可覆盖的产物；后来用户新增 osm 短入口并要求先不上传、后续须显式使用 $sdd-release，此要求只约束后续发布，不删除或撤销此前合法完成的 0.0.1。后续源记录不在已发布的打包快照中；没有 Git 提交/push、自动归档或再次发布。
