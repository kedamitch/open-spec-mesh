# 0.0.3 发布检查清单

## 授权与源码

- [x] 2026-10-03用户明确授权将当前代码提交/上传GitHub并发布npm 0.0.3；本次不包含Change归档或其他服务部署。
- [x] 官方registry发布前查询成功：只有0.0.1、0.0.2，latest=0.0.2；0.0.3尚未发布。上传前仍需再次核对。
- [x] 发布源码cc7d79909ce729f5749e19f338f8fba88884bd84已提交并推送main，包含全部100个待上传项目文件。发布后运维/流水线改动另作提交，不冒充此artifact源码。

## Build

- [x] package.json与两个锁文件根版本均0.0.3；锁文件字节一致，依赖版本不变，Node最低22。
- [x] 本机core内同产物consumer通过；另打包核对名称/版本/锁、文件范围与常见秘密签名通过。上传产物仍由CI从已提交源码重新生成并验证，不冒充此本地产物。

## Tests

- [x] 2026-10-03 Node24.21.0/npm11.19.0本机core：232项Node +5项Agent共237项，零失败/skip，9项required checks全通过；含真实隔离本地/全局tarball consumer。
- [x] 本轮Codex0.159.3 native V2确定性fixture通过，无真实远程推理；公共workflow副本一致。
- [x] OIDC run37107915145的prepare job通过：237项Node/Agent与9项core检查，361文件tarball审计及该同一产物consumer通过。
- 2026-10-01历史证据：237项Node/Agent core通过、当前宿主两角色派发及Explorer同session续用通过；不冒充2026-10-03重跑。
- full所有外部宿主和真实Worker并行写未本轮执行，不列为已通过；不重复运行收费对比。

## Database

- [x] 观测SQLite schema仍1，无外部业务数据库迁移，不清理旧数据或历史Change。

## Configuration

- [x] 继续使用GitHub Actions Trusted Publishing/OIDC：kedamitch/open-spec-mesh、npm-publish.yml、environment npm、main；不恢复本机token上传。
- [x] Main覆盖保留；Architect gpt-6.1-sol/xhigh、Explorer/Librarian gpt-6-luna/low、Worker/Reviewer gpt-6-luna/max。
- [x] 实际OIDC upload步骤success；未使用本机token上传，也未读/复制凭据。

## Documentation

- [x] 完整docs/01–09及既有Change/Task/Delivery、历史失败证据保留；新版本只增加Release Notes/Checklist。
- [x] 本轮文档结构、链接、公共workflow副本与Git whitespace检查通过；100个待提交源码/文档无常见秘密签名或私有归档。

## Deployment

- [x] 同run artifact的commit等于cc7d79909ce729f5749e19f338f8fba88884bd84；指纹与公开tarball一致。
- [x] OIDC真实上传一次成功；整个run结论failure，因为最终约两分钟只读传播核验超时。保留真实失败，不重传0.0.3。
- [x] 独立公共registry及dist-tags核验0.0.3/latest=0.0.3；实际记录时间2026-10-03T07:57:54.916Z（Asia/Shanghai 15:57:54）。
- [x] 公开tgz与同run已测试artifact逐字节相同；SHA-1 a1c5d6daab837baed338668b08a735fbf526bce6。
- [x] 本机独立执行verify与官方registry按open-spec-mesh@0.0.3的隔离真实consumer通过，不以本地tarball替代公开安装。
- [x] 本机global CLI/osm通过官方registry更新0.0.3；Codex Home/runtime为0.0.3，受管五角色/默认一致，实际Main自定义gpt-6-astra/medium未强制重置。Home AGENTS原字节保留，重复安装config/AGENTS字节不变；首次config整文件hash有变化，不声称首次全文件字节保留。

## Rollback

- [x] 可显式安装0.0.2回退CLI；Home回退须保全配置/技能，不自动unpublish、重复上传或清理历史。

## 发布状态

published：0.0.3已公开、latest=0.0.3，独立指纹/字节/公开consumer验证及本机更新通过。原Actions run标红仅因传播核验超时，不能称整条run全绿。


## 传播核验后续修正

原CI最后核验在2026-10-03T07:57:49Z超时，registry版本时间在其后约5秒；首次即时读取亦未见0.0.3，后续独立核验通过。未来helper改为最多约五分钟、15秒间隔、最多21次只读请求，比旧25次查询更少；版本已可见时立即返回，不重试上传。新增135秒传播的无真实等待回归，发布helper定向11项通过。该helper不在npm分发包中，后续提交只修未来发布流程，不更换已发布0.0.3产物。

私有证据：/var/tmp/osm-release-0.0.3-oDQeML；CI artifact、公开tgz、run状态、本机/consumer日志均保留，未保留凭据或对话正文。

发布后helper与最终材料的整体复验：233项Node +5项Agent共238项、零失败/skip、9项core检查通过，明确exit0；公共workflow与release结构检查通过。第一次外层命令中断的日志保留，未用中断状态冒充成功。五分钟指计划等待预算，不含每次有30秒超时的请求耗时；只读请求与上传重试始终分离。
