# 验证规范

## 实际验证

Node.js 22.0.0+ 执行测试、语法/安全、资源保全和消费包检查。核心入口 npm run validate:core；扩展验证 npm run validate:full 还需要实际宿主 CLI、Docker、Mermaid 和 Research 工具。缺少前置条件如实失败，不伪造通过。

文档结构、格式和链接检查是建议，不决定阶段授权或触发冻结；真实测试与安全错误必须处理。测试清单按当前 Node 场景发现，不绑定旧 Python 方法数或旧 Graph readiness。历史场景的有意退出和替代检查写本 Change Delivery，不能删除保留能力或 skip 取得通过。

## 当前结果边界

旧自动生命周期及其测试已退出；保留的 Node 回归覆盖安装/回滚、文档、观测/诊断、System One 和通用安全。用户已明确授权退出自托管 GPU 服务，剩余 3 个 Python 文件及专属 CI/依赖已删除。全仓 Python 清理检查坚持零例外；核心 Node 验证与扩展宿主/工具验证分别记录真实结果，不相互替代。没有自动验收 receipt，最终交付仍待用户确认。

## 2026-09-29 核心验证结果

GPU 退出确认后，Node.js 24.21.0 核心 profile 的 9 项 required checks 全通过；159 项项目回归 + 4 项 Agent 回归共 163 项通过、零失败/skip，119 JS 语法检查、零 Python 审计、安装 dry-run 与隔离 tarball 消费均通过。扩展 profile 的环境条件未在本轮重新收敛，不声称全绿、外部推理硬件验证或最终人工验收完成。

## 2026-09-29 Node 22 与全局安装追加验证

Node 22.0.0（npm 10.9.2）与当前 Node 24.19.0（npm 11.17.0）均通过核心 9 项 required checks，160 项项目 + 4 项 Agent 回归共 164 项、零失败/skip。真实 npm 全局 tarball 与源码目录入口、最低版本已安装 Skill/MCP、实际 Home 旧 Python/cache 清理另行验证通过。CI 核心矩阵覆盖 22.0.0、22.x、24.x。旧 24.21.0/163 项记录保持为当时事实，不代表本轮运行版本。见 [追加实施记录](../05-changes/C01-进行中/CHG-20260929-human-driven-workflow/C03-tasks/C03-06-node22-global-install/C03-06-02-delivery.md)。扩展 full 未在本轮完成，不声称全量外部环境通过或用户最终验收。

## 2026-09-29 npm 0.0.1 发布准备

0.0.1 版本/锁与 public publishConfig 下，以 Node 22.0.0 + npm 10.9.2 再跑 core：9 项 required checks、164 项 Node/Agent 回归全部通过，真实本地/全局消费验证使用 0.0.1。npm pack 文件与常见敏感模式检查、publish dry-run 通过；当前缺 npm 登录，未进行真实公共上传或 registry 按名消费，不能写“公共发布完成”。见 [发布准备记录](../05-changes/C01-进行中/CHG-20260929-human-driven-workflow/C03-tasks/C03-07-npm-publication/C03-07-02-delivery.md)。历史 0.1.0 证据不改写。

## 2026-09-29 osm 与显式发布的本地验证

osm 短入口及明确 $sdd-release 授权规范下，Node 22.0.0 + npm 10.9.2 core 的 9 项 required checks、171 项项目/Agent 回归全部通过；Node 24.19.0 的短入口/规范 10 项定向回归通过。真实本地 tarball 全局安装覆盖无参数 osm、预览和兼容入口；这不是 registry 发布。已公开 0.0.1 不含该入口，本轮未发新版、未改版本号。详见 [本地实施记录](../05-changes/C01-进行中/CHG-20260929-human-driven-workflow/C03-tasks/C03-08-osm-short-command/C03-08-02-delivery.md)。

## 2026-09-30 协作效率优化

Node.js24.21.0 / npm11.19.0：最终 core 为215项 Node +5项 Agent，9项 required checks 全通过，零失败/skip；136项JS语法检查、Python零例外、346个包文件范围及隔离本地/全局tarball consumer通过。Codex0.159.2 native V2 确定性fixture、OpenCode1.18.31 native config/agent/MCP、2项Node MCP SDK协议验证通过，均无真实远程模型评测。日志与限制见 [协作优化交付](../05-changes/C02-已完成/CHG-20260930-collaboration-efficiency/C04-delivery.md)。

full 未执行，Claude/mmdc 不在 PATH，其他外部环境不声称通过；真实模型质量、净收益和金额节省未验证。用户已明确直接close本次优化，归档不等于发布；历史验证日期和结果保留。

## 2026-10-01 Quick优化与真实本机验证

最终core为229项Node +5项Agent共234项，9项required checks通过，零失败/skip；138项JS语法、Python0、358个包文件及真实隔离本地/全局tarball消费通过。首次core的2失败已修复并定向复验，不用历史豁免；日志/var/tmp/osm-quick-optimization-1A9TnJ/core-final.log。Codex0.159.3 deterministic native V2通过；另执行真实Main/Explorer两臂，验收均通过，同Explorer两轮、模型gpt-6-luna/low、正式文档0；首次观测失败经同证据重解析通过，无重复模型请求。实际global/Home安装与runtime源文件一致验证通过。

当前对话宿主仍报旧模型，新启动CLI已通过；不声称热更新成功。full/其他宿主真实运行及真实Worker并行未本轮执行。金额与普遍成本优势未验证；详情见[追加评估](../05-changes/C01-进行中/CHG-20260930-collaboration-evaluation-pilot/C05-process-evaluation.md)。


## 2026-10-01 当前会话旧默认问题复核

前述“当前对话仍报旧模型”是08:24（Asia/Shanghai）的历史状态。09:18 configured Explorer新建、09:20同session继续、09:24 configured Librarian新建，均在同一Main与同一daemon中正常完成；实际子会话context三轮均gpt-6-luna/low，无spawn模型覆盖。版本匹配的Codex0.159.3源码确认默认模型校验发生在角色配置加载前，并使用turn配置快照；具体自动刷新触发事件未捕获，不承诺每个新turn或新线程自动生效。

新增旧默认恢复/自定义默认保留/安装不保证会话热更新三项回归后，本轮core为232项Node +5项Agent共237项，零失败/skip，9项required checks全通过；138项JS语法、Python0、358个包文件及隔离真实本地/全局tarball consumer通过。定向安装/核验30项另通过。私有日志/var/tmp/osm-host-dispatch-vg4pgf/core.log；实际派发元数据同目录dispatch-evidence-safe.log。未重复付费两臂对照，未重跑无关full/其他宿主，未测试真实Worker并行写，也未做公共发布或人工close。
