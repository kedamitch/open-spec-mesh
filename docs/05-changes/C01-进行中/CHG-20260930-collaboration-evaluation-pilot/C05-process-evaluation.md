# 本次流程评估

## 观察范围

样本为“协作评估可读性与strict退出”一个真实串行需求，授权/验收见[C01](C01-change.md)，实现及测试见[交付](C04-delivery.md)。旧Change关闭是前置独立工作，不纳入本样本实现文件计数。没有扫描私有对话、自动诊断包或新的模型评测；本报告自己是用户要求的评估工件，不作为每个Task的强制文档。

## 事实与代理指标

- 1个Main串行Task，0个新增子Agent、0个Worker/worktree、0次角色交接；没有因代理状态而等待/续跑。不是“已验证多Agent无开销”，而是本任务选择不委派。
- 1次需求到交付预览的连续授权；执行中0次新增人工确认等待。最终验收仍待用户，是刻意保留的授权边界，不说全生命周期已最终关闭。
- 先最小复现旧incomplete=0，再定向1次（11通过），core1次（220Node+5Agent、9检查通过），CLI三态验收fixture1组；最终文档写入后只复查文档/共享规则/whitespace与用户后缀，不重跑无变化代码。
- 0次代码测试失败、0次退回需求/设计/计划、0次扩大范围。1次命令构造NUL被工具拒绝后本地继续，和模型分层、业务设计无关；不能把工具错误计成未发生。
- 批量读取关闭相关文档时出现输出截断，随后缩小读取；这说明读取/结果返回粒度本身也可产生重复调查开销，不应全量转回Main。
- 本轮功能/测试/用法修改6个文件，其中运行时1、测试1、消费验证1、使用说明3；相对本轮备份，evaluation模块+2859字节、测试+5850、consumer+902、用法合计+1450。不是相对Git HEAD的全部上轮改动。
- 选定Main/子会话完整usage未采集，input/cached/output、金额、角色分层节省比例及端到端耗时均unknown。文件字节/文档数量只是维护规模代理指标，不换算token或价格；core测试duration也不是目标墙钟耗时。

## 文档固定开销实测

本样本保留6份必需正文与3份index（共9个文件），正文9251字节、导航682字节，合计9933字节；另有本次用户要求的1份流程评估报告，共10个文档文件。评估报告不是日常强制工件。统计只计算本Change，不把上轮归档/Current Truth同步计成本需求；字节不是token，完整结构下的固定写作成本仍值得进一步压缩。

## 断点与过度开销

| 发现 | 本轮事实/影响 | 处理与后续方向 | 优先级 |
|---|---|---|---|
| incomplete可exit0，容易把“命令成功”看成“评估全绿” | 最小复现确认；属于工具输出到人工/脚本消费的真实断点 | 本次已加md醒目标识与显式strict=3，默认兼容；即使pass仍需人工语义验收 | 已修复 |
| 小任务结构的固定写作/导航成本仍在 | 一个Task仍需C01/C02/计划/Task/两层Delivery和导航，不能因优化删结构 | 进一步采用单任务短写示例：C01验收、C02契约、plan一行、Task只写局部方向、Delivery实际增量；批量刷新导航可用现有Node函数，不启动模型 | P1 |
| plan / Task /派发内容可能重复 | 本轮无派发仍要计划与Task；多Agent再抄一份会放大交接 | plan只写依赖/执行方式，Task保留可执行目标/验收并引用公共状态表；dispatch指向Task+必要增量，不重生成完整方案 | P1 |
| 五阶段被误解为必须五轮用户往返 | 本轮一条连续授权避免了中途等待，最终确认尚待 | 明确允许“到交付预览”为一次范围授权；仍记录实际授权，范围/安全变化和最终交付不能擅自越过 | P1 |
| close被操作成固定两次确认可能再增加等待 | 本次上轮用明确“直接close”一次完成实现/最终确认与归档 | 实现确认与最终确认概念区分但不强制两次对话；明确覆盖两者的自然语言可合并，不把“继续”自动当归档 | P1 |
| 代码用法已更新但Current Truth到close才同步 | 本轮新能力已存在，API/Q01最终快照仍待同步，长时间不close可能过时 | 交付显式列出待同步事实；后续明确“实际源码现状”与“人工验收状态”分开，避免继续积累状态债务；本次不擅自改审批语义 | P1 |
| core会再执行定向测试，容易误判重复成本 | 定向用于快反馈，core重叠用于集成；本轮只跑1次core | 按证据失效程度选择复验；最后文档改变只跑docs/static，不再跑native/全core。保留真实安全检查，不把成本目标当跳测理由 | 保留当前 |
| 源码规则与已安装Home/活动会话存在交付落差 | 上轮和本轮都未授权Home更新；源规则调整不等于运行会话重载 | 交付持续显式标注“源码/已安装/活动会话”三种范围；需要部署验证时另获安装授权，使用只读inspect，不自动改模型或Home | P2 |
| 读取过大返回截断导致复读 | 本轮批量文档输出已发生截断 | 按问题与受影响片段定向读取；在合适规模才用Explorer压缩材料，不为了“降低Main成本”机械加一个代理 | P1 |
| 真实多Agent收益没有被本样本测到 | 单Main样本不包含架构→Worker交接、并行冲突或完整模型用量 | 下一次选择真正存在大量陌生事实/可并行边界的需求，用户明确授权后做少量对照；不为凑benchmark拆这个小任务 | P2 |

## 结论

对这个已知的小需求，Main连续执行比新增角色更合理；设计没有锁死文件/函数，内部实现没有重开计划，结构也未删。剩余最明显的成本是完整工件的固定写作/维护和批准边界的解释，不是需要新调度器。下一步优先做“保留结构的单任务短写示例、授权范围的一次清晰说明、Current Truth时点澄清”，再选择有真实委派收益的需求评估模型分层。这里只报告一个样本，不声称框架已普遍省钱或多Agent端到端验证完成。

## 2026-09-30 Quick多Agent补充验证与合并比对

### 授权、模式与文档纠偏

用户要求“验证一下多agent执行的场景…和刚刚…执行的场景快速…合并比对…优化方案”，并质疑Main连续执行为何产生大量文档。本轮选择Quick验证：不创建新的Change/Task/Delivery/导航，只将用户要求的结果补入本已有评估报告。实验副本和证据保存在私有临时目录/var/tmp/osm-multiagent-quick-6VXAL6，不改项目实现、模型、Home或版本。

Main连续执行是执行策略，Quick/SDD是流程模式，两者不能混同。上轮新试迭代由Main继续按SDD组织，沿用了完整工件；这不是连续执行必须产生文档。Main应提前明确模式与授权，关闭旧Change后不能仅因“端到端”把新验证默认升级/延续为SDD。Quick不建正式Change/Task；如用户要求报告或真实Current Truth受影响，可以更新对应已有文档，不等于“禁止所有文档”。用户“保留完整结构”应理解为不删除已有结构，不意味着每个Quick任务复制整套结构。

### 实际试验与派发断点

采用已有collaboration-store-v1，fixture SHA256=3b8dc0fb475627bf70a61ec5526e4e878eccbae79c4e66ea3e41e90e39cb01fd，从同一未修复baseline复制Main与Main+Explorer两臂，验收源码一致。目标为get归一化键、missing仍undefined；不安装依赖。

- Main臂：先验证已知缺陷的预期红灯，再只修src/store.js，baseline与acceptance共2项通过。预期红灯是fixture准备检查，不是规划返工。
- 多Agent臂：真实调用configured explorer、fork_turns=none，最小只读派发（目标、路径、三条行号证据、简短结论、无测试/写入；Main负责实施/集成）。用户未明确授权并行写，因此没有启动Worker/worktree。
- 一次真实派发被宿主拒绝：Unknown model gpt-5.6-luna；可用模型列出gpt-6-luna、deepseek-flash、gpt-6.1-sol、gpt-6-astra。没有返回Agent ID，成功启动/交接0；该臂未实施、未验收，全部源码字节仍与baseline一致。没有重试或用其他角色/模型伪装成功。
- 随后只读inspect-host：已安装Explorer为gpt-6-luna/low，与包默认一致；其他受管角色也一致；活动会话仍unknown。只能证明“文件期望”与“派发实际错误”不一致，不能确定缓存、配置层、映射或其他具体根因，也不能声称重启即可修复。
- 本轮没有完整Main/子会话用量与计费数据；失败派发是否产生任何宿主计量未知，不写零成本。测试命令约62.5ms仅是Node验收命令耗时，不是Main全程、LLM耗时或节省比例。

### 与上一轮合并比对

| 范围 | Main单Agent SDD（上轮） | Main单Agent Quick（本轮） | Main+Explorer Quick（本轮） |
|---|---|---|---|
| 目标 | 真实CLI可读评估/strict | 固定fixture get归一化 | 与本轮Main相同目标/基线/验收 |
| 实际状态 | 交付预览；220Node+5Agent/core9通过 | 修复完成；2项fixture验收通过 | 派发阻塞；不是已完成样本 |
| 成功子Agent/交接 | 0/0 | 0/0 | 0/0；真实失败派发1次 |
| 新正式文档 | 6正文+3index，约9.9KB；另有专项评估 | 0 | 0 |
| 验证责任 | Main定向一次/core一次 | Main预期红灯准备+修复后验收 | 原计划Explorer只读、Main实施/集成；未执行到此处 |
| 设计返工 | 0次重开需求/设计/计划 | 无正式规划链，无重开 | 未开始，不作零返工/质量推断 |
| 实际成本比较 | 完整usage/金额未知 | 完整usage/金额未知 | 未执行完成，不能计算比率 |

上轮CLI任务与本轮fixture不是等价目标，不能拿测试数量、文档字节或命令耗时证明速度/模型成本差异；只能比较模式产生的工件与责任安排。同目标两臂基线一致，但多Agent臂启动失败，因此还没有成功的受控性能/品质对照，更没有验证Worker并行或Architect→Worker交接。

### 合并后的优化方案（本轮不擅自扩大实现）

| 优先级 | 优化 | 保留边界/验收 | 原因 |
|---|---|---|---|
| P0 | 修复宿主实际角色加载/模型映射差异，再作一次真实最小委派 | 不改用户Main/model/effort、不只看静态TOML；必须拿到真实子Agent结果与Main验收 | 当前真实多Agent执行在入口失败，任何节省讨论都需先解决可执行性 |
| P0 | 新目标默认Quick，SDD仅按本目标明确选择/授权 | Quick不生成Change/Task/Delivery链；既有docs与历史完整保留 | 上轮主要文档固定开销来自模式选择，不来自Main或多Agent |
| P0 | 让双模式技能的交付引导明确分支 | Quick直接给真实交付摘要；仅已有SDD Change才引导sdd-close；加载技能不自动切模式 | sdd-do兼容Quick，但统一指向sdd-close的文字可能造成模式混淆 |
| P1 | 成功多Agent优先验证Main+一次定向只读调查/原session增量 | 不引入Architect/Reviewer；Main不重复调查；按问题返回最小证据 | 先验证最短交接链，再评估是否真的压缩Main上下文 |
| P1 | 并行写验证仅在用户明确授权后选真实独立工作边界 | Worker独立worktree、定向验证；Main集成一次，失败不能豁免 | 不为一个已知小修复制造并行，避免交接固定成本反而更高 |
| P1 | 保留SDD结构，提供单任务短写示例及只引用不复制的派发 | C01/C02/plan/Task/Delivery结构仍完整；必要验收不空心化 | 需要SDD时降低内容重复，而不是删除结构 |
| P1 | 安装/升级后一次真实委派smoke，日常不每轮预检 | 文件核验、真实派发、活动会话事实分层记录；能力未知不误绿 | 本次暴露静态/native fixture不能替代真实启动；但强制每轮模型探针又会增加开销 |
| P2 | 成功同目标/同验收后再做少量成本对照 | 包含Main、子Agent、失败派发、消化结果、集成与修复；范围不全则unknown | 未完成样本和小型fixture不能证明模型分层省钱 |

优先顺序应从“压缩SDD文档”调整为“默认Quick与交付分支清晰 → 修复真实派发入口 → 成功验证最小交接 → 有收益时才并行/分层”。本轮已实际按Quick执行且没有新正式文档；优化表是待实施方案，不把文字建议称为规则/宿主已修复。

## 2026-10-01 已实现优化与本机安装验收

本次用户授权“开始实现，按顺序完成所有优化 并在本机完成安装测试”，按Quick执行；不新建Change/Task/Delivery链，不归档原试迭代。既有01–09与历史全部保留。源码/实际Current Truth已同步；这不代替原Change的最终人工确认。

| 顺序 | 实际实现 | 结果/边界 |
|---|---|---|
| P0 模式 | 通用单源明确新目标默认Quick，连续执行/端到端/加载技能不自动升级，不为保留结构复制工件 | 五个受管副本一致，根AGENTS项目专用后缀保全 |
| P0 技能分支 | sdd-do Quick无需C01/C02/Task，直接交付；已有SDD才引导sdd-close。Current Truth与人工验收状态分开，明确合并授权可一次close | 不新增审批/自动生命周期；新试验两臂均0正式文档 |
| P0 默认模型 | inspect-host增加安全的subagent_defaults核验；安装显式--migrate-legacy-agent-defaults只处理旧gpt-5.6-luna，保留任意其他默认、effort与Main | 本机旧回退迁至gpt-6-luna/max；Main仍gpt-6.1-sol/high，五角色一致 |
| P1 最小交接 | 可选真实验证helper检查一次Explorer+同session增量+Main实施/验收，不注入模型覆盖 | fresh Codex0.159.3中Explorer真实gpt-6-luna/low，两轮，同一ID；没有Worker/Reviewer/Architect |
| P1 文档/并行边界 | 独立单任务短写参考；公共方案引用、Task保留可执行验收；并行必须真实独立边界、明确授权、worktree与验证分工 | 不新增固定字数/文件权限/强制角色；本轮未授权真实Worker并行写，不伪造已测 |
| P1 升级smoke | scripts/verify_codex_live.js仅显式--run触发真实请求，不属于core/full或每轮预检；--reanalyze复用已有证据，不调用模型 | 没有自动收费探针；首次观测修复后用同批记录复核 |
| P2 成本对照 | 固定同baseline/目标/验收、分角色usage_observed、覆盖与限制；V2别名经唯一父会话/角色/别名元数据关联UUID，识别新metadata且不重复计token_usage_record | analysis1.2.1，SQLite schema1不变；不复制对话、思维过程或凭据，不输出金额/普遍节省 |

### 真实同目标试验

两个新启动CLI使用已安装配置与现有认证，在私有夹具执行同一规范化读取修复；固定验收不准修改。每臂只改src/store.js，2项验收通过，0个正式文档。wall time包含该CLI启动、推理、交接、实现与验证，不含本Main准备/本项目优化/报告；不是整个优化目标的总耗时。

| 试验会话 | 实际模型/effort依据 | 输入token（含缓存） | 缓存输入 | 输出 | 臂wall time |
|---|---|---:|---:|---:|---:|
| Main直接 | 保留本机Main配置；未传覆盖参数 | 57415 | 44288 | 379 | 25.61s |
| Main+Explorer中的Main | 同Main配置；未传覆盖参数 | 104703 | 91264 | 858 | 整臂72.26s |
| 同一Explorer的两轮累计 | 实际子会话context=gpt-6-luna/low、fork=none | 93570 | 77568 | 459 | 已包含在上行臂耗时，不再相加 |

该小样本未体现委派收益：多Agent臂耗时约2.82倍，Main自己的输入与输出也更多，另外还有子会话用量。输入含缓存且模型计费不同，没有价格，不能把token比例换算金额；这是一次有意强制最小委派的执行验证，不是合理净收益任务的普遍benchmark，也未验证大范围调查压缩或Worker并行速度。结果支持已实施的“已知小任务Main直接完成，不机械分层”，不支持禁用所有委派。

### 真实失败、修复与边界

- 首次live helper命令exit1：实际修复与验收均过，但V2返回task_name而非UUID，旧解析器无法关联已启动子会话。已修复别名关联及world_state/token_usage_record/inter_agent消息兼容；--reanalyze同批记录exit0，没有重新付费跑两臂。原始失败记录保留，不称首次命令全绿。
- 首次core 227项中225过、2失败：一个是别名合并引入undefined破坏兼容JSON序列化，一个是旧Quick文案断言。修复并定向19项通过，再执行最终core；没有退回需求/设计或换执行者。
- 当前对话安装后的一次configured Explorer探针仍报Unknown model gpt-5.6-luna。文件与新启动CLI已正确，当前宿主实际路径尚未载入/选用新配置；具体缓存/配置层原因未确定。没有反复重试、覆盖model或强制中断本对话。fresh进程成功不冒充当前对话已热更新；需实际宿主加载新配置后另核验。

### 最终本机与质量结果

- 最终core：229项Node +5项Agent共234项，0失败/skip，9项required checks全通过；138项JS语法、Python0、358个包文件、隔离实际本地/全局tarball consumer通过。Codex0.159.3 deterministic native V2另通过，不当作真实推理；真实推理由上表独立记录。full/其他宿主真实运行未本轮执行。
- 当前源码打包为0.0.2本地tgz，已真实安装到本机npm global与Codex Home/runtime；未发布或提交/推送。全局open-spec-mesh/osm入口、迁移help、新inspect字段与已安装runtime的--reanalyze均验证通过；8个关键实现/技能/参考文件与源码逐字节一致。
- 最终重复安装时config.toml与Home AGENTS字节不变，保留Main/user内容；既有Research工具未重装。原始产物SHA512与日志保存在/var/tmp/osm-quick-optimization-1A9TnJ，不把本地产物当公共registry新发布。最终报告/质量材料在安装后补记，安装包是此前已验证源码快照，不冒称包含补记后的全部文档。
- 本次未生成新正式Change/Task/Delivery，只补现有报告/实际Current Truth及复用技能参考。保留旧试迭代待人工确认状态，不自动close/发布。


## 2026-10-01 旧默认模型根因与当前会话复核

本轮按Quick继续排查，不创建新Change/Task/Delivery，不改变本试迭代待人工确认状态。保留上一轮失败证据；下列结果取代“当前宿主仍未验证成功”的现状判断，不把历史失败改写为成功。

### 根因与证据边界

- 旧Home回退gpt-5.6-luna是早期inspect只核角色TOML所遗漏的配置；安装保留已有覆盖的规则使其不能仅靠更新角色文件消失。上轮显式迁移已解决落盘旧值，默认现为gpt-6-luna/max，Main仍gpt-6.1-sol/high。
- 核对与本机Codex0.159.3匹配的上游rust-v0.159.3，commit01fc69f4026735edfdf6789820549727a4867b11：codex-rs/core/src/agent/child_config.rs的prepare_agent_spawn_config先apply_requested_spawn_agent_model_overrides（第62行），再apply_spawn_agent_role（第73行）；默认读取turn.config.agent_default_subagent_model（第204行），先经过catalog校验。旧默认不被catalog接受时，在角色配置加载前已拒绝。因此“角色全匹配”不能消除回退阻断。
- 08:03首次本机安装之后，08:24同Main派发仍收到Unknown model gpt-5.6-luna，符合仍使用旧turn快照的路径。本轮直接连实际daemon的Unix WebSocket控制接口，config/read包含工作区层：默认为gpt-6-luna/max、来源Home，无项目层旧默认覆盖；未读取认证文件，RPC输出只保留允许的配置/状态字段。
- 当前Main UUID与daemon PID均未变化。本轮真实派发恢复；具体哪个宿主刷新事件使旧turn快照换成新配置未捕获，不虚构是重启、MCP刷新或新线程必然热重载。本轮没有写配置或执行刷新/重启RPC，没有覆盖spawn模型，也没有给旧模型造catalog别名。

### 当前宿主真实验证（Asia/Shanghai）

| 时间 | 验证 | 实际证据 | 结果 |
| --- | --- | --- | --- |
| 2026-10-01 09:18:46 | configured Explorer新建、fork_turns=none | child01a0f50a-e2b5-72b3-9f3a-6ba7c131636e，context gpt-6-luna/low | EXPLORER_DISPATCH_OK |
| 2026-10-01 09:20:04 | 同一Explorer增量继续 | 同child第二个turn仍gpt-6-luna/low，不新建代理 | EXPLORER_CONTINUATION_OK |
| 2026-10-01 09:24:16 | configured Librarian新建、fork_turns=none | child01a0f50f-e9c2-7ee2-84b4-c23a87c7c9cd，context gpt-6-luna/low | LIBRARIAN_DISPATCH_OK |

三个探针均不调用工具、不读取/修改项目文件；是本轮明确排查授权内的最小真实推理，不是默认检查，也不是重跑两臂benchmark。并未启动Worker/Architect/Reviewer，真实并行写仍未授权/验证。仅测试派发与续用，不声称专业任务质量、普遍成本收益或所有历史会话自动恢复。

### 最小防复发改动

- inspect-host的旧默认Markdown告警说明“默认先验、角色后加载”，给出同Home显式迁移入口，并明确实际宿主加载与真实子会话验证责任；JSON仍是installed_files_only，live_session保持unknown，不伪造实时状态。
- 安装完成提示不再用“start a new session”暗示生效保证，而是说明只更新安装文件，实际宿主需加载配置并验证派发。未加入自动重启/全局热刷新或收费探针。
- 新回归覆盖：五个角色文件全一致仍必须提示旧默认恢复；当前与任意自定义默认不触发旧值迁移提示；真实隔离CLI安装不能承诺现存会话已更新。定向30项通过、零失败/skip。

私有证据/var/tmp/osm-host-dispatch-vg4pgf包含最小RPC字段、派发时间与子会话模型元数据、版本匹配上游源码、定向检查和改动前基线；不复制对话正文/思维过程/凭据，旧测试与失败证据不删除。
