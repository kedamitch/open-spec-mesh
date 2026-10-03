# npm 公共分发与发布操作

## 当前已核验状态（2026-10-03）

open-spec-mesh@0.0.3已通过GitHub Actions OIDC run37107915145真实上传；registry时间2026-10-03T07:57:54.916Z，latest=0.0.3。发布源码cc7d79909ce729f5749e19f338f8fba88884bd84的CI artifact与公开tgz逐字节一致，SHA-1 a1c5d6daab837baed338668b08a735fbf526bce6；361个包文件审计、同产物consumer及发布后的独立公开npm consumer通过。

原run的prepare与upload成功，但最终约两分钟传播核验在07:57:49Z超时，registry版本时间在其后约5秒；整条run为failure，不伪造全绿，也不重新上传。未来只读核验已改为最多五分钟、15秒间隔、最多21次查询；已可见时立即结束，网络/认证/指纹错误仍不重试上传。该发布helper不在npm分发包中，后续修正不更换0.0.3产物。

本机global CLI/osm与Codex Home/runtime已从官方registry更新0.0.3。实际Main自定义gpt-6-astra/medium不按包默认强制重置，默认子代理gpt-6-luna/max、受管五角色一致。Home AGENTS字节保留；首次config整体hash发生变化，不能称首次全文件字节保持，重复安装后config/AGENTS字节稳定。没有收费重跑、真实Worker并行、Change归档或其他服务部署。

实际发布与边界见[0.0.3检查清单](../../09-delivery/D01-发布记录/D01-03-v0-0-3/D01-03-02-release-checklist.md)。以下0.0.2及认证诊断段落均为历史，不覆盖当前0.0.3或恢复已完成的旧发布授权。

## 0.0.2 历史已核验状态（2026-09-30）

open-spec-mesh@0.0.2 已通过 GitHub Actions OIDC 真实发布，latest=0.0.2；registry 时间 2026-09-30T08:34:06.836Z。公开 tarball 与提交 c7af582 的已验证 CI artifact 逐字节一致，SHA-1 为 02c75cb6dadc3497846155e530d80f4a60f5d5cf。公共 registry 全新安装、CLI/Codex host smoke 和实际本机 npm/Home 更新均通过。Architect 为 gpt-6.1-sol/xhigh；Explorer/Librarian 为 gpt-6-luna/low，Worker/Reviewer 为 gpt-6-luna/max。当前源码和受管角色未发现 gpt-5.6-luna 活动配置。不得重复上传已发布的 0.0.2，其他版本需新的明确发布意图。

原 run 36690250138 的 upload 步骤成功，但发布后 25 秒窗口未看见版本，verification 因超时标红；独立核验随后通过，不把整条原 Actions run 说成绿色。未来只读核验窗口扩大至约两分钟，仍不循环重传。以下未发布/认证失败章节均为历史诊断记录，不能覆盖当前已核验状态。

## 发布对象与边界

包名 open-spec-mesh，当前稳定版本 0.0.3（每次发布仍须明确目标版本）；Node >=22.0.0，公共 registry 为 https://registry.npmjs.org/。package.json 的 publishConfig 固定 public access 与该 registry，避免误发到默认私有镜像。

npm 包包含第一方 Node 工具、受管 Role/Skill、规范参考和发布锁。不包含用户 Home、npm 凭据、node_modules、测试源码或 Python 实现。根 package-lock 与 npm-shrinkwrap 必须字节相同，根版本与 package.json 一致；依赖固定版本不因此次改版本而升级。

发布 npm 不等于 Git push、Change 归档、最终人工验收、宿主安装或外部服务部署。

## 用户安装

```sh
npm install -g open-spec-mesh@0.0.3 --registry=https://registry.npmjs.org/
open-spec-mesh --version
open-spec-mesh install --host codex --skip-tools --dry-run
open-spec-mesh install --host codex --skip-tools
```

仅已发布版本可通过包名获取；E404 不得解释为安装成功。可将 --host codex 替换为 opencode 或 claude，并用 --host-home 指定目标根。npm 安装不自动改宿主配置；--skip-tools 跳过 Research 工具安装，System One 保持默认关闭。

不装全局命令时，用 npm exec --yes --registry=https://registry.npmjs.org/ --package=open-spec-mesh@0.0.3 -- open-spec-mesh install --host codex --skip-tools。升级需先 npm install -g open-spec-mesh@latest，再显式 install 更新宿主；卸载全局命令不清理宿主资产。

## 真实上传的人工授权

真实 npm 上传以用户明确的发布意图和本次目标版本为授权依据。“发布 0.0.2”这样的自然语言指令等同于调用 `$sdd-release` 并授权上传该版本；Main 应自动使用该技能，不要求用户重写为技能口令。仅要求准备材料时不上传；没有明确发布意图时，“继续”、测试通过、授予权限或过去的发布授权不能单独产生上传授权。明确要求不上传时停止发布；不自行选择其他版本或覆盖已发布版本。

## 发布者前置检查

1. 用户明确授权版本与公共发布。确认未覆盖其他未提交工作，不自动提交、打 tag 或归档。
2. 查询公共 registry 的已发布版本；查询失败不能当作版本不存在，不能复用已发布 name@version。长期流程使用 GitHub Actions OIDC，不要求 CI 的 npm whoami 成功；手工 token 发布才单独检查账户及目标包权限。
3. package.json、package-lock、npm-shrinkwrap 根版本须匹配本次明确目标（当前稳定版0.0.3）；引擎 >=22.0.0；bin 为 open-spec-mesh 与 osm，private=false，公共 publishConfig 正确。
4. 使用 Node 22.0.0 + 兼容 npm 验证 core，真实 tarball/local/global consumer 可启动。full 的外部前置/结果另记，不伪造外部环境通过。
5. npm pack 到仓库外的私有准备目录；检查实际 tarball 的文件名单、README、资源、锁文件与敏感文件/常见密钥模式。不得发布 auth.json、.npmrc、私钥、.env、诊断 ZIP、数据库或用户会话。

## 长期发布：GitHub Actions + npm Trusted Publishing（2026-09-30）

当前选定长期方案为 GitHub-hosted runner 与 npm OIDC；不添加 NPM_TOKEN / NODE_AUTH_TOKEN secret，不依赖本机 granular token 进行每次上传。初始状态：工作流及保护测试先在本地编写，当时尚未提交推送、绑定或运行。后续进度见下方追加的实际操作记录；不能据本地编写完成宣称 0.0.2 已公开发布。

### 一次性信任绑定

npm 官方参考：

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/cli/v11/commands/npm-trust/

信任对象必须与工作流一致：

| 配置项 | 本项目值 |
|---|---|
| npm 包 | open-spec-mesh |
| GitHub 仓库 | kedamitch/open-spec-mesh |
| Workflow filename | npm-publish.yml（仅文件名，不含目录） |
| GitHub environment | npm |
| 发布能力 | allow-publish |

先把 0.0.2 真实源码、锁文件、工作流和 helper 一起提交到 main 并推送；不得只提交工作流后从仍为旧版本的远程源码发布。版本发布授权不自动授权提交已有的大量未提交修改。

在 GitHub 建立 npm environment，将可部署分支限制为 main；按团队需要设置 required reviewers。工作流引用此 environment，npm 绑定也必须填写 npm；不匹配将无法通过信任验证。此流程不自动修改仓库保护、管理员权限或 npm 账号安全设置。

本机 npm 11.19.0 已提供 npm trust github。管理 trusted publisher 仍需有效的账户认证和 2FA；bypass-2FA token 不能替代管理操作的交互认证，现有认证请求 401 也不能靠改为 OIDC 命令自动修复。如果没有启用账户 2FA，先由账户持有人完成启用。

服务器没有桌面浏览器时，在真实交互终端执行以下一次性认证；--browser=false 只打印认证链接，可在自己的手机或另一台电脑打开。不要向 Agent 或聊天提供密码、token、认证链接或 OTP。配置放到私有临时目录，不覆盖 ~/.npmrc 中的原有 token。

```sh
BOOTSTRAP_DIR=$(mktemp -d)
chmod 700 "$BOOTSTRAP_DIR"
npm login --auth-type=web --browser=false \
  --registry=https://registry.npmjs.org/ \
  --userconfig="$BOOTSTRAP_DIR/npmrc"

npm_config_browser=false npm trust github open-spec-mesh \
  --repo=kedamitch/open-spec-mesh \
  --file=npm-publish.yml --env=npm --allow-publish \
  --registry=https://registry.npmjs.org/ \
  --userconfig="$BOOTSTRAP_DIR/npmrc"

npm trust list open-spec-mesh \
  --registry=https://registry.npmjs.org/ \
  --userconfig="$BOOTSTRAP_DIR/npmrc"
```

终端按提示完成 OTP 或网页验证，不把验证码放到参数、日志或文档。也可以在 npm 包设置页完成同样绑定。完全没有任何可用的交互认证设备时，当前已被 registry 拒绝的凭据无法完成这一步；不能承诺纯自动绕过。一次性配置成功后，退出该临时登录并删除临时配置；日常 CI 发布不需要继续保留此凭据。

### 日常发布和保护

工作流路径为 .github/workflows/npm-publish.yml；仅 workflow_dispatch 手动指定稳定版本，main-only，无 push/tag/PR 自动发布和自动升版本。若本机有已认证的 GitHub CLI，可直接从终端触发：

```sh
gh workflow run npm-publish.yml --repo kedamitch/open-spec-mesh --ref main -f version=0.0.2
gh run list --repo kedamitch/open-spec-mesh --workflow npm-publish.yml --limit 5
# 选中上面实际返回的 run id：
gh run watch RUN_ID --repo kedamitch/open-spec-mesh --exit-status
```

本轮环境未找到 gh，不把该命令写成已经执行。没有 gh 时可在 GitHub Actions 手动运行；触发 workflow 是实际发布动作，仍需要明确的本次版本发布意图。

prepare job 不授予 id-token 权限，使用固定 Actions commit、Node 24、npm 11.19.0，运行 core（含新发布测试），检查版本/锁文件/仓库身份和干净提交，查询 registry，打包、敏感路径/常见凭据格式检查并真实安装同一 tarball，随后保存 tarball 与 release-artifact.json。publish job 使用独立 GitHub-hosted runner、npm environment 和 id-token: write，下载同一 run 的 artifact，核对 commit/integrity/shasum，重新确认版本未发布，才执行一次 npm publish。没有长期 npm secret，不在本机模拟 OIDC 上传。

即使上传返回错误，仍做独立公共 registry 核验；仅为版本/tag 的传播进行有界只读轮询，绝不循环重传。已存在版本、非 200 registry 查询、指纹不匹配均停止。上传后核对 latest、SHA-512/SHA-1，再在隔离临时 Home 与空 npm 配置中按包名从公共 registry 真实安装，验证两个 CLI 与 Codex --skip-tools 安装，并检查新技能存在、旧技能未被发现。

原 /tmp/osm-npm-0.0.2-IQix3M/open-spec-mesh-0.0.2.tgz 保留为此前本机发布失败的证据，不上传到本流程冒充新提交的 CI 构建。CI 会基于已提交源码重新生成并验证 artifact，指纹可能不同；发布成功证据必须对应新的同一 CI artifact。

### 本轮验证边界

- 新发布保护测试 7 项直接运行通过，helper 语法检查通过。
- 当前沙箱限制下，完整 core 未获得通过结果：诊断包测试报 keep_bundle_outside_project_and_git，部分子进程报 spawnSync EPERM；registry 请求连接本机代理也报 EPERM。不得用此前 182 个测试通过记录替代此次修改后的完整验证。
- npm 信任绑定、远程工作流、OIDC 上传、registry 版本与消费者安装仍未实际验证。工作流保留完整 core 和同一 artifact 的安装验证作为上传前检查，不跳过或豁免失败。

## 手工发布回退：登录、预演、真实上传

未登录时，由用户在本机终端执行：

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

不要在聊天、文档、命令行参数或仓库中保存密码/token/验证码。浏览器登录及 registry 请求的双因素验证按 npm 本机提示完成；没有认证不反复尝试上传。

发布经检查的同一 tarball，而非从可能继续变化的工作区临时重新打包：

```sh
npm publish /absolute/path/open-spec-mesh-0.0.2.tgz \
  --access public --registry=https://registry.npmjs.org/ --dry-run

# 用户授权的真实公共上传；dry-run 通过不代表此步完成。
npm publish /absolute/path/open-spec-mesh-0.0.2.tgz \
  --access public --registry=https://registry.npmjs.org/
```

如果 requires OTP / account permission / authentication 失败，记录真实错误并由用户处理，不把 E403、EOTP、ENEEDAUTH 或 dry-run 当成成功。公共 npm 发布要求双因素认证，或具备必要包发布权限并启用 bypass 2FA 的 granular access token；登录成功本身不足以证明满足发布条件。无浏览器服务器可由用户在自己的其他设备完成账户安全设置与认证；token 由用户在本机安全配置，不提交仓库或发送聊天。

## 上传后独立验证

```sh
npm view open-spec-mesh@0.0.2 version dist.integrity dist.shasum \
  --json --registry=https://registry.npmjs.org/
```

确认 registry 版本与 integrity/shasum 对应准备的 artifact，再在隔离临时 Home/global prefix 中从 registry 按包名安装，验证 open-spec-mesh --version、--help 和实际 --skip-tools 宿主安装；不读取或改写真实用户配置。这样才证明其他用户可以获取和运行，不只证明本地打包可运行。

若发布后发现问题，通常用新的版本修复；不自动 unpublish、变更 dist-tag 或覆盖历史版本。撤回等破坏性 registry 操作需用户单独授权。

## 2026-09-29 本次进度

0.0.1 已真实 public 发布，registry 发布时间 2026-09-29T09:49:44.527Z，latest=0.0.1，registry integrity/shasum 与此前验证的 tarball 一致。Node 22.0.0 的无认证公共消费者已按包名全局安装，并验证 CLI、项目文档和三宿主受管配置安装。先前 ENEEDAUTH、EPERM、E403 保留为历史排查，不代表当前发布仍失败。

此前用户仅要求 osm 本地实现/测试，未授权上传。2026-09-29 用户已明确要求发布 0.0.2，并确认自然语言发布指令应自动使用 sdd-release；本次据此授权发布 0.0.2，不覆盖 0.0.1。上传完成与否以 registry 核验记录为准。

## 0.0.2 实际发布状态（2026-09-29）

用户已明确授权“发布 0.0.2”，并要求自然语言发布指令自动选择 sdd-release。源码及锁文件为 0.0.2；Node 22.0.0 和 Node 24 的 core 均通过 9 项检查（182 个 Node 测试 + 4 个 Agent 测试）。320 文件的最终 tarball 完成敏感文件/常见密钥模式检查、真实 npm 安装与旧 Home 升级，包名 open-spec-mesh，public registry，latest 为本次目标 tag。

真实上传已执行一次，但 2026-09-29T15:24:30.973Z 返回 E403：npm 要求 2FA 或启用 bypass 2FA 的 granular access token。当前账户 fatfei，profile 的 tfa=false；registry 独立核对仍仅有 0.0.1，latest=0.0.1。0.0.2 尚未公开发布，不能将 dry-run 或本地安装说成 registry 发布成功。需用户在本机完成认证，再继续发布同一已验证 artifact；不索取聊天中的密钥或验证码，不要求用户再次输入技能名。


用户随后声明本机已配置具备 npm 发布权限的 granular token；凭据值不记录。当前共享命令环境的新一轮检查中，`npm whoami` 返回 E401，单次目标版本提交返回 E404；registry 仍只有 0.0.1/latest=0.0.1。token 的本机配置事实与当前 npm CLI 不能实际使用可认证凭据这两点分别记录。0.0.2 没有发布成功。


### 2026-09-30 只读原因诊断补充

用户确认 token 未过期，不能从 E401 直接推断失效。请求观察仅检查 Authorization 头存在性，官方 registry 请求携带该头；代理与直连均为认证端点 401、ping 与公开元数据 200；npm 11.17 与 11.19 结果相同。目标包 collaborators GET 和官方只读发布权限状态 GET 也为 401，不是单独 whoami 失败。剩余需要核对 token 的 package grants、Allowed IP Ranges 及当前本地配置是否对应用户所指 token；不读取 token 值，不修改凭据/账号安全设置，本轮没有再次发布。

## 用户授权后的只读复核（2026-09-30）

用户明确表示权限已给，Main 据此进行了真实只读验证，不重复索要 npm 发布授权，也未上传。当前执行环境的 npm whoami、npm trust list 和公开 npm view 均在连接 127.0.0.1:1086 时返回 connect EPERM；移除代理的公开查询返回 getaddrinfo ENOTFOUND registry.npmjs.org。此次没有获得 npm registry 的 HTTP 认证结果，不能把这些错误解释为 token 过期或权限不足，也不能据此判断当前版本/tag 或 npm trust 是否已配置。日志在 /tmp/osm-oidc-permission-check-cache，未读取 token 值。

GitHub MCP 的独立只读检查成功：远程 main 的 .github/workflows 仍只有 laya.yml 和 validate.yml，没有 npm-publish.yml；因此本地 OIDC 发布流程尚未上线，不能测试真实 workflow/OIDC 上传。新发布保护测试再次直接运行，7 项通过。未提交、推送或重试上传。

## 授权推送与恢复网络后的进度（2026-09-30）

用户明确授权“OIDC 推送，然后继续验证发布流水线”。网络权限已生效；本机官方 registry 公开查询成功，仍只有 0.0.1/latest=0.0.1；npm trust list 实际返回 HTTP 401，不读取 token，也不据此断言 token 过期或信任绑定不存在。GitHub 临时 CLI 使用官方 gh 2.102.0 发布包并核对 SHA-256，内部使用已有 keyring 登录；仓库账户具有 push/admin 权限，未读取或复制 GitHub 凭据。

已创建 npm GitHub environment，并设定仅 main 分支允许部署；不添加长期 npm secret、不修改全局分支保护或账户 2FA。已将提交前的 tracked diff 和 untracked 源码保全到仓库外私有目录。main 仅领先 origin/main，无分叉；按用户授权以普通快进方式提交推送本次 0.0.2 源码及 OIDC 工作流，不 reset/stash/rebase，不新增版本或 tag。

本机 /tmp/.git 标记导致隐私路径测试将临时输出判为 Git 树内；此标记不删除。换用 /var/tmp 的真实 Git 树外私有 TMPDIR 后，当前源码完整 core 9 项均通过，包含 189 个 Node 测试和 4 个 Agent 测试、敏感资源/锁文件检查及真实 local/global tarball consumer。此前沙箱/错误临时路径下的失败保留为证据，不作为豁免。原已验证 tarball 指纹再次核对一致。

下一步：推送已授权的源码快照，真实触发一次 0.0.2 OIDC workflow，记录其 build、artifact、token exchange、upload 和 public consumer 实际结果；不能将 GitHub 写入权限当作 npm Trusted Publisher 配置成功。

## 首轮远程验证及 helper 修复（2026-09-30）

提交 9aad63916981988b3718c64fb9e788ab8c4218c4 已真实快进推送到 main，远程工作流内容与本地核对一致。已按本次 0.0.2 发布授权触发 workflow_dispatch，run 36675589841。GitHub-hosted runner 的 core 完整通过；prepare 的同一 tarball consumer 阶段失败：npm 报 userconfig/globalconfig 共同指向一个空文件导致 double-loading config。publish job 被跳过，没有上传；失败后独立 registry 查询仍只有 0.0.1/latest=0.0.1。

修复为两个独立私有空配置文件，并隔离 npm/OIDC token 环境键；新增真实 npm config get registry 回归，不能只依赖模拟测试。后续重新提交此实现修复并运行流水线，属于有明确代码修复的重新验证，不是同一错误下盲目重传。

## 第二轮远程结果及只读 OIDC 诊断（2026-09-30）

修复提交 0b38554f9d213620af1863c1ab17e9502fdcee0c 已推送，run 36676111203。prepare 全部通过：190 个 Node + 4 个 Agent 测试、完整 core、320 文件包审计和真实同一 tarball consumer。publish job 下载 artifact、核对 commit/integrity 并查询未发布版本成功；实际 npm publish 返回 ENEEDAUTH，未取得可用发布凭据。错误本身不能证明 npm Trusted Publisher 不存在；npm 11.19 的 OIDC helper 会吞掉 exchange 错误后回退到通用缺少认证错误。独立 registry 校验仍只有 0.0.1/latest=0.0.1。CI artifact 已从该 run 下载，SHA-1 为 272b6e0b352c54d041b4565e51df0d5045ac5e6e，SHA-512 与 release-artifact.json 核对一致，指纹不冒充原本机 tarball。

加入 verify_only boolean（默认 false）进行不上传的 OIDC 诊断：先仅检查 GitHub Actions/OIDC 变量的存在性，再使用 npm publish --dry-run --loglevel=verbose，保留 exchange 的具体服务端拒绝原因；真实上传与发布后 consumer 都被条件排除。dry-run 即使回退到缺少凭据仍可返回成功，不能把绿色诊断 job 当成 OIDC 或真实发布成功；以具体 exchange 消息为证据。此诊断不是再次上传。

## 当前实际结果：npm OIDC exchange 被拒绝（2026-09-30）

诊断提交 306dfd0ea5b350d6706ebf44938bab70e200751d 已推送，verify_only=true 的 run 36676720147 已完成。GitHub-hosted runner 完整 core 9 项再次通过（191 个 Node + 4 个 Agent 测试），prepare、320 文件 tarball 审计和同一 tarball consumer 通过。publish job 的存在性检查为 githubActions=true、requestUrlPresent=true、requestTokenPresent=true，未读取或记录 token 值。npm 的 POST /-/npm/v1/oidc/token/exchange/package/open-spec-mesh 返回 404；verbose oidc 仅给出错误信息：OIDC token exchange error - package not found。公共包查询同时正常，仍只有 0.0.1/latest=0.0.1，不能把 exchange 的 404 当成包真的不存在。

当前可确定失败点为 npm 未为当前 GitHub OIDC 声明换发发布凭据；更具体是尚无匹配信任配置还是已有配置不匹配，现有证据不能区分。本机 npm trust list 仍为 401，无法读取其实际绑定；不从此推断 token 过期。需要 npm 包维护者一次性核对/配置 kedamitch/open-spec-mesh / npm-publish.yml / environment npm，以及直接发布能力。GitHub 仓库写权限和环境已就绪，不自动赋予 npm 信任。首次绑定仍需 npm 账户认证/2FA；无桌面服务器可以 --browser=false 在终端打印链接，使用可信其他设备完成认证。无需把 token 或 OTP 给 Agent。

诊断 job 的 success 只表示 dry-run 诊断执行完成：真实 Publish 步骤和公共 registry consumer 均 skipped，0.0.2 未发布。本轮未再次真实上传。此前第二轮 artifact 从 GitHub 下载后已独立核对两种指纹，并在本机隔离 Home 中真实 npm 安装和 Codex --skip-tools 验证通过；该结果仍是 tarball 消费，不是 registry 发布。配置核对完成前停止真实上传；修复绑定后可恢复同一目标版本的已有授权，不重新要求技能口令。新 CI artifact 保留，原本机 artifact 亦保留，不用本机失效的调用路径替代 OIDC 方案。

## 发布前模型更新与绑定后重试（2026-09-30）

用户确认已通过 npm 页面配置 Trusted Publisher，并明确要求发布前将当前模型切换为 gpt-6.1-sol。已同步 Architect TOML、模型约束校验和原生 Codex 确定性 fixture catalog；保留 xhigh、其他角色模型及历史执行证据。新增回归同时检查新模型路由与旧模型配置拒绝。本机主角色文件已使用新模型；旧已安装 runtime 将在新包发布成功后按真实 npm 安装更新，不以旧 artifact 冒充此次模型改动。提交、验证后按明确授权重试 0.0.2 的 OIDC 流程，不使用本机长期 token 上传，不生成新版本或改写历史 tag。

模型更新后的完整 core 9 项已通过（191 个 Node + 5 个 Agent 测试）；本地 codex-cli 0.159.2 的原生 Multi-Agent V2 确定性 fixture 验证通过，Architect 实际请求 model 为 gpt-6.1-sol、effort 为 xhigh，并保留 Architect -> Explorer 路由。未调用远程模型，不把 fixture 通过当成外部模型供应商可用性证明。当前活动配置无旧模型；唯一旧模型文字为负向回归测试输入。

## 0.0.2 最终 registry 与本机验证（2026-09-30）

用户新增的 Luna 名称要求已核对：当前仓库 Main 默认及四个 Luna 角色已是 gpt-6-luna，实际 Home 中的四个角色也是该值，无需伪造替换 diff；用户自定义 Main 模型/effort 不因此被强制覆盖。发布 run 36690250138 的源码 commit 为 c7af582792386e59ad291aed9a2316e00a5c2782，包含新 Architect 配置。上传步骤真实成功、registry version/latest 都为 0.0.2，存在 provenance 元数据；此处未声称独立验证 provenance 签名。

已下载同一 run 的 release-artifact.json 和 tgz，核对 SHA-512/SHA-1，再无认证下载公开 registry tarball，与 CI artifact 逐字节比较一致。完整 SHA-512：sha512-RliTGs0juGKpP4yQN/7n1PFuooFZUqk6xoSoVIXsASRJBPjMV4YHxAT0rrT/UWL08JiBVIxjFUYdgsdeJBlvbg==；SHA-1：02c75cb6dadc3497846155e530d80f4a60f5d5cf。使用隔离 Home/cache/config 从 registry 按包名真实 npm 安装，两个 CLI 与 Codex --skip-tools 安装通过；随后本机全局 npm 从公开 registry 更新至 0.0.2，更新受管 Home/runtime，并分别确认 npm 包、Home 角色文件、安装 runtime 的五个角色模型与 effort 均正确。私有日志和 metadata 在 /var/tmp/osm-public-0.0.2-61UGV5，无 token/OTP。

原 Actions 最后一步仅因 25 秒只读传播窗口未得到新版本而失败；发布后的独立复核补足真实结果，不重跑 publish、不覆盖 0.0.2、不自动 unpublish/tag/归档。脚本默认轮询预算扩为 25 次/5 秒间隔（约两分钟）并加回归；这些后续 CI helper 与记录改动只提交到 Git，不重发已公开包，也不伪称属于 c7af582 artifact。
