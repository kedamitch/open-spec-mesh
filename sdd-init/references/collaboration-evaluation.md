# 小规模协作效果对照

可选、离线准备，不是日常前置步骤，不自动调用真实模型或授权并行。静态提示词检查、确定性 native fixture、归一化 trace 检查与真实模型评测分别记录，不相互替代。

## 固定输入

[固定项目夹具](collaboration-benchmark.json) 保存源码字节、基线测试、六个明确任务；[场景期望](collaboration-scenarios.json) 保存可自动检查的动作预算及仍需人工判断的语义。夹具名为 collaboration-store-v1；试验前对两个 JSON 分别算 SHA-256，并记录待测框架源码 revision、未提交 diff 的摘要、模型/provider/effort、工具版本和环境。没有推理价格时只比较用量，不填金额。

在隔离目录把 baseline_files 按指定相对路径写出，不安装任何依赖；用 Node.js 执行 `node --test baseline.test.js` 验证准备结果。local-fix 的 acceptance_test 另存 acceptance.test.js 后，未修复基线应失败，修复后应通过。其他场景的人工验收不能用“测试绿色”替代。每个试验臂从同一份未修改源码重新复制，不能沿用前一臂的修复或对话。真实执行由操作者选择，不自动创建 worktree、改Home或启动付费服务。

## 三种试验臂

| 试验臂 | 适用与边界 |
|---|---|
| Main 直接完成 | 所有场景的串行基线；由当前 Agent 连续完成，不新起 Worker |
| Main + 定向调查 | 仅有真实调查信息缺口的场景；包含准备派发、调查、Main消化结果及补充的全部成本 |
| 明确授权的独立并行 | validation-ownership；不同测试文件和真实可共享基线，包含集成和修复成本 |

不是每个任务都必须跑三种臂；不适合委派的 local-fix 不为了凑表强制派发。先跑少量代表性样本，只有需要比较波动时才重复；不默认大规模 benchmark。保持验收、上下文输入、模型配置和工具能力可比，环境故障与人工等待单列。

## 采集与自动检查

使用已有私有观测库，在目标完整范围内收集 Main 和已确认子会话；多轮工作分别采集后使用不重叠的 `observe group`，不能只统计便宜子 Agent。查看 `usage_observed`（已知部分）、`usage_total`（覆盖完整时才有）、用量覆盖、失败派发、增量继续、验证次数及总耗时。并行分组没有可证明的墙钟区间时保持 unknown，不将各会话耗时简单相加。

可选返工标注仅传事件 ID 和受控原因，避免保存对话或秘密：

```sh
open-spec-mesh observe --db PRIVATE_DB collect --run RUN --root PROJECT \
  --session-file TRACE --rework-mark fix-1:handoff
open-spec-mesh observe --db PRIVATE_DB report --run RUN --format json > PRIVATE_REPORT
open-spec-mesh evaluate-collaboration --report PRIVATE_REPORT --scenario local-fix
# 可读预览；严格模式使证据不完整返回3，而不是默认的0
open-spec-mesh evaluate-collaboration --report PRIVATE_REPORT --scenario local-fix \
  --format md --fail-on-incomplete
open-spec-mesh evaluate-collaboration --list
```

`--rework-mark` 原因仅 assumption / handoff / integration，可重复，非强制。标注是操作者提供的部分证据，不是脚本推断，不证明没有其他返工。跨run采用同一事件ID避免重复；同ID不同原因显示冲突/unknown。

评估工具只检查规范化动作是否符合所选场景期望，不路由任务、不批准阶段、不调用模型。partial/opaque 日志中的缺席为 unknown。budget 只适用于指定夹具条件，不能据它禁止合法的因证据失效而复验。语义升级、净收益、用户授权、已有结果是否真正消化仍需人工核对。默认输出JSON，--format md生成可读报告（也支持--list）；JSON字段和动作判定不变。默认退出码0仍可表示incomplete以保留兼容；自动化可显式--fail-on-incomplete，此时不完整退出3。检查失败退出1，参数错误退出2；通过动作检查退出0也不代表语义质量、用户授权或人工验收完成。必须读取status和semantic_quality，不能说“所有行为已通过”。

## 对照记录

每个样本记录：夹具/场景SHA、框架revision、试验臂、实际模型/effort、验收结果、Main与子会话input/cached/output、覆盖状态、完整耗时、人工等待、失败派发、增量继续、返工标注及证据。先比较同验收下的完整任务用量与失败/返工，再看耗时；不把更多Agent、更少文档或fixture绿色当节省。真实模型结果未产生前结论为未验证。

## 本机真实对照入口

按用户明确验证意图可运行 `node scripts/verify_codex_live.js --run --output PRIVATE_DIR`；它使用现有本机认证，不复制凭据、不改Home/model/effort，在同一未修复夹具运行Main与Main+Explorer，收集实际验收与规范化元数据。真实推理有成本，不加入core/full默认检查，不每轮运行。失败臂不当成功样本；单样本与已知小任务仅验证执行/交接，不证明普遍节省。

观测解析修复后可用 `node scripts/verify_codex_live.js --reanalyze --output PRIVATE_DIR` 复核同一批原始记录，不重新调用模型。子会话只按父会话/角色/别名的唯一元数据关联，不扫描或复制无关对话。CLI用量是root-only，关联子会话后按角色列出usage_observed；缺失保持unknown，不把所有输入token当非缓存计费或金额。
