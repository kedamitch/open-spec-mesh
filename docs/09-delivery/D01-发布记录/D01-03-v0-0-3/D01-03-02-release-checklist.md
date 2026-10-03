# 0.0.3 发布检查清单

## 授权与源码

- [x] 2026-10-03用户明确授权将当前代码提交/上传GitHub并发布npm 0.0.3；本次不包含Change归档或其他服务部署。
- [x] 官方registry发布前查询成功：只有0.0.1、0.0.2，latest=0.0.2；0.0.3尚未发布。上传前仍需再次核对。
- [ ] Git提交/推送完成；记录实际源码commit。

## Build

- [x] package.json与两个锁文件根版本均0.0.3；锁文件字节一致，依赖版本不变，Node最低22。
- [x] 本机core内同产物consumer通过；另打包核对名称/版本/锁、文件范围与常见秘密签名通过。上传产物仍由CI从已提交源码重新生成并验证，不冒充此本地产物。

## Tests

- [x] 2026-10-03 Node24.21.0/npm11.19.0本机core：232项Node +5项Agent共237项，零失败/skip，9项required checks全通过；含真实隔离本地/全局tarball consumer。
- [x] 本轮Codex0.159.3 native V2确定性fixture通过，无真实远程推理；公共workflow副本一致。
- [ ] GitHub prepare job全量core与同一CI tarball consumer。
- 2026-10-01历史证据：237项Node/Agent core通过、当前宿主两角色派发及Explorer同session续用通过；不冒充2026-10-03重跑。
- full所有外部宿主和真实Worker并行写未本轮执行，不列为已通过；不重复运行收费对比。

## Database

- [x] 观测SQLite schema仍1，无外部业务数据库迁移，不清理旧数据或历史Change。

## Configuration

- [x] 继续使用GitHub Actions Trusted Publishing/OIDC：kedamitch/open-spec-mesh、npm-publish.yml、environment npm、main；不恢复本机token上传。
- [x] Main覆盖保留；Architect gpt-6.1-sol/xhigh、Explorer/Librarian gpt-6-luna/low、Worker/Reviewer gpt-6-luna/max。
- [ ] 实际流水线认证和上传结果待核验；存在绑定配置或GitHub权限不等于实际发布成功。

## Documentation

- [x] 完整docs/01–09及既有Change/Task/Delivery、历史失败证据保留；新版本只增加Release Notes/Checklist。
- [x] 本轮文档结构、链接、公共workflow副本与Git whitespace检查通过；100个待提交源码/文档无常见秘密签名或私有归档。

## Deployment

- [ ] 本次GitHub Actions源码SHA与已测试artifact一致。
- [ ] OIDC真实上传一次；上传结果和整个run状态分别记录。
- [ ] 独立registry核验0.0.3、latest=0.0.3及integrity。
- [ ] 公开tgz与同run已测试artifact逐字节相同。
- [ ] 官方registry按包名/版本的隔离真实npm consumer通过。
- [ ] 本机global CLI与Codex Home/runtime更新并保留自定义配置。

## Rollback

- [x] 可显式安装0.0.2回退CLI；Home回退须保全配置/技能，不自动unpublish、重复上传或清理历史。

## 发布状态

pending：尚未上传，不以打包、dry-run、测试或准备材料代替真实发布。
