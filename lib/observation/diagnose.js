import { legacyJson } from '../runtime/compat-json.js';
import { digest } from './trace.js';

export const VERSION = '1.1.0';
const TOKENS = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
const ref = (event) => `${event.source ?? 'unknown'}:${event.locator ?? `L${event.line ?? 0}`}`;
const uniqueSorted = (values) => [...new Set(values)].sort();
const isPrefix = (value, prefixes) => prefixes.some((prefix) => value.startsWith(prefix));

export function diagnose(run) {
  const events = run.events ?? [];
  const findings = [];
  const traceFull = (run.host?.native_trace ?? 'full') === 'full';
  const tools = events.filter((event) => event.kind === 'tool');
  const mode = run.expectation?.mode ?? 'unknown';
  const sdd = run.sdd ?? { association: 'unknown', tasks: [], events: [] };
  const calls = tools.filter((event) => event.fact?.kind === 'agent.spawn');
  const add = (rule, category, conclusion, evidence, action) => findings.push({ rule, category, conclusion, evidence: uniqueSorted(evidence), action });
  for (const call of calls) {
    if (call.status === 'failed') add('D01', 'observed_failure', `${call.fact.role} 委派已尝试但返回失败；不是未调用。`, [ref(call)], '检查该次工具响应、角色注册和运行时错误；不要先增加“必须调用”提示词。');
  }
  const policies = (run.sessions ?? []).filter((session) => session.id === run.root_session).flatMap((session) => session.policies ?? []);
  const restricted = policies.filter((item) => item.signal === 'explorer_requires_complex');
  const conflicting = policies.some((item) => item.signal === 'unrecognized_explorer_rule');
  const currentRestrictions = (run.snapshots ?? []).filter((item) => item.policy === 'explorer_requires_complex');
  for (const role of run.expectation?.roles ?? []) {
    const roleCalls = calls.filter((event) => event.fact.role === role);
    if (roleCalls.length || !traceFull) continue;
    if (['explorer', 'librarian'].includes(role) && ['quick', 'sdd', 'simple'].includes(mode) && (restricted.length || currentRestrictions.length) && !conflicting) {
      const basis = restricted.length ? '运行时指令中' : '当前文件中（不证明该轮已加载）';
      const evidence = restricted.length ? restricted.map(ref) : currentRestrictions.map((item) => `${item.path}@${(item.digest ?? '').slice(0, 12)}`);
      add('D02', 'policy_restriction', `${basis}，Explorer/Librarian 被旧规则限定在已批准 Complex；与当前 Quick/SDD 的调查权限冲突。`, evidence, '先复核是否要把“调查委派”与“Complex 设计审批”解耦；不自动修改规则，也不把缺少委派判成模型失误。');
    } else add('D03', 'needs_review', `操作者期望 ${role}，选定执行范围未观察到其 spawn；必要性及工具可用性不能由缺席推断。`, [`expectation:operator`, `coverage:${run.coverage?.status ?? 'unknown'}`], '核对实际工具目录、审批和决策当时的信息缺口；补齐证据后再判断是否属于漏调。');
  }
  const executed = tools.filter((event) => event.status === 'success');
  const workflow = executed.filter((event) => isPrefix(event.fact?.kind ?? '', ['change.', 'task.', 'design.']));
  if (['sdd', 'simple', 'complex'].includes(mode)) {
    if (traceFull && !workflow.length && sdd.association === 'unknown') add('S01', 'needs_review', '本次期望使用 SDD，但未观察到成功的 SDD 命令，且没有唯一 Change 关联。', ['expectation:operator', `coverage:${run.coverage?.status ?? 'unknown'}`], '先补充 --change 或完整 rollout；不能仅凭“无日志”断言没有按 SDD 执行。');
    if (sdd.status === 'not_found') add('S02', 'artifact_gap', '显式指定的 Change 在当前项目的进行中/已完成目录均不存在。', [`change:${sdd.change_id}`], '核对项目/分支/Change 标识，确认是否在实现后才补文档；当前文件状态不代表历史状态。');
  }
  for (const event of tools.filter((item) => item.status === 'failed' && isPrefix(item.fact?.kind ?? '', ['task.', 'change.']))) add('S03', 'observed_failure', `SDD 命令 ${event.fact.kind} 实际失败。`, [ref(event)], '检查该事件的本地原始结果；不要把调用过 Skill/脚本等同于完成该阶段。');
  const byTask = new Map();
  for (const event of executed) {
    const fact = event.fact ?? {};
    if (fact.change_id && fact.task_id && event.at) {
      const key = `${fact.change_id}\u0000${fact.task_id}`;
      if (!byTask.has(key)) byTask.set(key, []);
      byTask.get(key).push(event);
    }
  }
  for (const [identity, entries] of byTask) {
    const taskId = identity.split('\u0000')[1];
    for (const [before, after] of [['task.prepare', 'task.submit'], ['task.submit', 'task.accept']]) {
      const left = entries.filter((event) => event.fact.kind === before);
      const right = entries.filter((event) => event.fact.kind === after);
      if (left.length === 1 && right.length === 1 && right[0].at < left[0].at) add('S04', 'needs_review', `${taskId} 观察到 ${after} 早于 ${before}；需核实是否跨 attempt 或错误排序。`, [ref(left[0]), ref(right[0])], '用对应 attempt 的 Task history 核对，不允许仅由时序提示自动 replan。');
    }
  }
  if (['sdd', 'simple', 'complex'].includes(mode)) {
    const writes = events.filter((event) => (event.kind === 'implementation.write' || event.fact?.kind === 'implementation.write') && event.status === 'success' && event.at);
    const creates = workflow.filter((event) => event.fact.kind === 'change.create' && event.at);
    if (creates.length === 1 && writes.length && writes.map((event) => event.at).sort()[0] < creates[0].at) {
      const earliest = [...writes].sort((a, b) => a.at.localeCompare(b.at))[0];
      add('S05', 'needs_review', '记录到成功代码写入早于本轮 Change 创建；可能存在先实现后补契约。', [ref(earliest), ref(creates[0])], '核实写入是否属于同一需求或既有 Change；确定后再修正入口顺序，不自动判违规。');
    }
    if (sdd.graph === 'absent' && calls.some((event) => event.status === 'success' && event.fact.role === 'worker')) add('S06', 'artifact_gap', '已观察到 Worker 委派，但显式关联 Change 当前没有 Task Graph。', [sdd.source, ...calls.filter((event) => event.fact.role === 'worker').map(ref)], '检查 Task/Change 关联或缺失工件；纯文档 Change 不强制建 Task。');
  }
  const sessionRoles = new Map((run.sessions ?? []).map((session) => [session.id, session.role]));
  for (const call of calls) {
    const caller = sessionRoles.get(call.session);
    if (['worker', 'reviewer', 'explorer', 'librarian'].includes(caller)) add('D04', 'observed_action', `观察到 ${caller} 发起子代理委派。`, [ref(call)], '对照该轮角色 Prompt 的叶子约束；职责应放在角色 Prompt/运行时，不扩写主 AGENTS.md。');
  }
  const skillReads = executed.filter((event) => event.fact?.kind === 'skill.read');
  if (traceFull && ['sdd', 'simple', 'complex'].includes(mode) && !skillReads.length) add('P01', 'unknown', '未观察到成功的显式 SKILL.md 读取；不能据此判断 Skill 未加载或未执行。', [`coverage:${run.coverage?.status ?? 'unknown'}`], '检查隐式加载/注入和真实工件。AGENTS 自动加载也不要求出现 cat 调用。');
  const digests = new Map();
  for (const item of run.snapshots ?? []) if (item.instruction_digest && item.path.endsWith('AGENTS.md')) digests.set(item.instruction_digest, (digests.get(item.instruction_digest) ?? 0) + 1);
  for (const [checksum, count] of digests) {
    if (count > 1) add('P02', 'configuration_candidate', '当前全局与项目 AGENTS.md 含相同全文，存在重复规则候选。', (run.snapshots ?? []).filter((item) => item.instruction_digest === checksum).map((item) => `${item.path}@${checksum.slice(0, 12)}`), '项目文件只保留工程差异；先核对实际指令链，不把当前重复文件直接认定为运行时重复 Token。');
  }
  if (conflicting) add('P03', 'unknown', '记录中存在未识别或变化后的 Explorer 路由规则，停止自动归因。', policies.map(ref), '比较对应规则版本；脚本不从自然语言推导权限覆盖关系。');
  if (run.coverage?.issues?.length) add('C01', 'unknown', '执行证据覆盖不完整；缺失与未知不会计为通过或零开销。', run.coverage.issues.map((issue) => `coverage:${issue}`), '补齐子会话/结束事件或升级适配器；不生成模型解释。');

  const history = sdd.events ?? [];
  const directRework = history.filter((event) => event.action === 'rework' && event.direct === true);
  const accepted = (sdd.tasks ?? []).filter((task) => task.state === 'accepted');
  const eligible = accepted.filter((task) => task.attempt != null && history.some((event) => event.task_id === task.id && event.state === 'submitted'));
  const firstPass = eligible.filter((task) => task.attempt === 1 && !directRework.some((event) => event.task_id === task.id)).length;
  const rootEvents = events.filter((event) => event.session === run.root_session);
  const start = rootEvents.find((event) => event.kind === 'turn.start')?.at;
  const end = [...rootEvents].reverse().find((event) => event.kind === 'turn.end')?.at;
  let duration = null;
  if (start && end) { const seconds = (Date.parse(end) - Date.parse(start)) / 1000; duration = seconds >= 0 ? seconds : null; }
  const knownUsage = (run.sessions ?? []).map((session) => session.usage).filter((usage) => usage != null);
  const usage = knownUsage.length ? Object.fromEntries(TOKENS.map((key) => [key, knownUsage.every((row) => Object.hasOwn(row, key)) ? knownUsage.reduce((sum, row) => sum + BigInt(row[key]), 0n) : null])) : null;
  const metrics = {
    sessions_observed: (run.sessions ?? []).length, spawn_attempts: calls.length,
    spawn_success: calls.filter((call) => call.status === 'success').length,
    spawn_failed: calls.filter((call) => call.status === 'failed').length,
    spawn_unknown: calls.filter((call) => call.status === 'unknown').length,
    resume_attempts: tools.filter((event) => event.fact?.kind === 'agent.resume').length,
    local_read_commands: executed.filter((event) => event.fact?.kind === 'local.read').length,
    skill_read_commands: skillReads.length, sdd_successful_commands: workflow.length,
    tasks_observed: (sdd.tasks ?? []).length, tasks_currently_accepted: accepted.length,
    first_pass: { numerator: firstPass, denominator: eligible.length }, direct_rework: directRework.length,
    dependency_invalidations: history.filter((event) => event.action === 'rework' && event.direct === false).length,
    replan_events: history.filter((event) => event.action === 'replan' && event.direct === true).length,
    wall_seconds: duration, usage_observed: usage, usage_coverage: { numerator: knownUsage.length, denominator: (run.sessions ?? []).length }, diagnostic_model_calls: 0,
  };
  return { ...run, analyzer_version: VERSION, findings, metrics };
}

export function cell(value) {
  return String(value ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('`', "'").replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function markdown(run) {
  const host = run.host ?? { name: 'codex', native_trace: 'full' };
  const lines = [
    '# 执行行为诊断', '', `Run：\`${cell(run.run_id)}\`；Host：\`${cell(host.name)}\`；native trace：\`${cell(host.native_trace)}\`；规则集：\`${VERSION}\`；额外模型调用：**0**。${run.members ? ` 分组成员：${run.members.join(', ')}` : ''}`, '',
    `选定会话：\`${cell(run.root_session)}\`；Turn：\`${cell(run.turn)}\`；期望模式：\`${cell(run.expectation.mode)}\`（操作者标注，不是模型事实）。`, '',
    '## 诊断', '', '| 规则 / 分类 | 结论 | 证据定位 | 最小修正建议 |', '| --- | --- | --- | --- |',
  ];
  for (const finding of run.findings ?? []) lines.push(`| ${cell(finding.rule)} / ${cell(finding.category)} | ${cell(finding.conclusion)} | ${cell(finding.evidence.join('<br>'))} | ${cell(finding.action)} |`);
  lines.push('', '## 会话', '', '| Slice | Session | Parent | Role | 实际 Model / Effort | 用量可归因 |', '| --- | --- | --- | --- | --- | --- |');
  for (const session of run.sessions ?? []) lines.push(`| ${cell(session.slice_id ?? run.run_id)} | ${cell(session.id)} | ${cell(session.parent)} | ${cell(session.role)} | ${cell(`${session.model} / ${session.effort}`)} | ${session.usage !== null ? 'true' : 'false'} |`);
  lines.push('', '## 时间线', '', '| 时间 | Session | 事件 | 结果 | 证据 |', '| --- | --- | --- | --- | --- |');
  const hidden = new Set(['usage.total', 'context', 'other.command', 'other.tool', 'local.read', 'opaque']);
  for (const event of [...(run.events ?? [])].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.source.localeCompare(b.source) || a.line - b.line)) {
    const kind = event.fact?.kind ?? event.kind;
    if (hidden.has(kind)) continue;
    lines.push(`| ${cell(event.at)} | ${cell(event.session)} | ${cell(kind)} | ${cell(event.status ?? event.outcome)} | ${cell(ref(event))} |`);
  }
  lines.push('', '## SDD 状态历史', '', '| Task | State / Action | Attempt | 原始时间 | 证据 |', '| --- | --- | --- | --- | --- |');
  for (const event of run.sdd.events ?? []) lines.push(`| ${cell(event.task_id)} | ${cell(`${event.state} / ${event.action}`)} | ${cell(event.attempt)} | ${cell(event.at)} | ${cell(ref(event))} |`);
  lines.push('', '## 指标', '', '| 指标 | 值 |', '| --- | --- |');
  for (const [key, value] of Object.entries(run.metrics ?? {})) lines.push(`| ${cell(key)} | ${cell(typeof value === 'object' ? JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item) : value)} |`);
  lines.push('', '首轮通过率以可归因且已验收 Task 为分母，不包含运行中/未知任务；直接返工与下游失效分开。', '用量是已观测范围的累计差值，不反复累加 cumulative counter；子会话缺少起始基线时为 unknown，不估算账单。', '',
    '## 配置版本与覆盖', '', `当前配置指纹：\`${cell(run.configuration_fingerprint)}\`（事后文件清单，不证明该轮已加载）。`, '', '| 文件 | 状态 | 指纹 |', '| --- | --- | --- |');
  for (const item of run.snapshots ?? []) lines.push(`| ${cell(item.path)} | ${cell(item.status)} | ${cell(item.digest)} |`);
  lines.push('', `覆盖问题：${(run.coverage.issues ?? []).join(', ') || '未发现已支持格式的覆盖缺口；仍不证明日志包含全部运行行为。'}`, '', '脚本不读取思维链来推断原因，不保存原始对话/工具输出/源码，不自动改 AGENTS.md、角色 Prompt 或 Skill。', 'unknown、needs_review 是待核实而非违规。自然语言需求、委派必要性、提示词因果贡献不由本脚本判定。', '');
  return lines.join('\n');
}

export function summary(runs) {
  const lines = ['# 行为诊断版本汇总', '', '不同模式和配置指纹分组；仅描述关联，不宣称提示词改动导致结果变化。', '', '| 期望模式 / 配置指纹（事后） | Run 数 | 覆盖不足 | 委派失败 | 首轮通过 Task / 可评 Task |', '| --- | --- | --- | --- | --- |'];
  const groups = new Map();
  const latestChanges = new Map();
  for (const run of [...runs].filter((item) => !item.members).sort((a, b) => a.collected_at.localeCompare(b.collected_at))) {
    if (run.sdd?.change_id) latestChanges.set(`${run.project_key}\u0000${run.sdd.change_id}`, run);
  }
  for (const run of runs) {
    if (run.members) continue;
    const key = `${run.expectation.mode}\u0000${run.configuration_fingerprint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  for (const [key, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [mode, fingerprint] = key.split('\u0000');
    const snapshots = [...latestChanges.values()].filter((run) => run.expectation.mode === mode && run.configuration_fingerprint === fingerprint);
    const first = snapshots.reduce((sum, run) => sum + run.metrics.first_pass.numerator, 0);
    const eligible = snapshots.reduce((sum, run) => sum + run.metrics.first_pass.denominator, 0);
    const fields = [ `${mode} / ${fingerprint.slice(0, 16)}`, members.length,
      members.filter((run) => run.coverage.status === 'partial').length,
      members.reduce((sum, run) => sum + run.metrics.spawn_failed, 0), `${first}/${eligible}` ];
    lines.push(`| ${fields.map(cell).join(' | ')} |`);
  }
  const counts = new Map();
  for (const run of runs.filter((item) => !item.members)) for (const finding of run.findings) {
    const key = `${finding.rule}\u0000${finding.category}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  lines.push('', '## 重复问题', '', '| 规则 / 分类 | 事件数 |', '| --- | --- |');
  for (const [key, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) lines.push(`| ${key.replace('\u0000', ' / ')} | ${count} |`);
  lines.push('', 'Task 指标按项目与 Change 的最新工件快照去重，不按每轮重复累计；分配到最新观测的配置组不代表因果归属。', '当前版本不进行自动因果归因、综合打分或模型复审；比较需使用相同任务样本和完整证据。', '');
  return lines.join('\n');
}

export function groupRuns(members) {
  if (!members.length || members.some((run) => run.members)) throw new TypeError('Group needs flat collected runs, not nested groups');
  if (new Set(members.map((run) => run.project_key)).size !== 1) throw new TypeError('Cannot group different projects');
  if (new Set(members.map((run) => `${run.root_session}\u0000${run.turn}`)).size !== members.length) throw new TypeError('Overlapping root session/turn selections cannot be grouped');
  const seenEvents = new Set();
  for (const run of members) for (const event of run.events) {
    if (event.kind === 'context') continue;
    const key = `${event.source}\u0000${event.line}`;
    if (seenEvents.has(key)) throw new TypeError('Overlapping child event ranges cannot be grouped');
    seenEvents.add(key);
  }
  const latest = members.reduce((a, b) => a.collected_at >= b.collected_at ? a : b);
  const result = structuredClone(latest);
  result.members = members.map((run) => run.run_id);
  const modes = uniqueSorted(members.map((run) => run.expectation.mode));
  result.expectation = { mode: modes.length === 1 ? modes[0] : 'unknown', roles: uniqueSorted(members.flatMap((run) => run.expectation.roles)), source: 'explicit_member_group' };
  result.root_session = 'multiple'; result.turn = null;
  result.events = members.flatMap((run) => run.events);
  result.sessions = members.flatMap((run) => run.sessions.map((session) => ({ ...session, slice_id: run.run_id })));
  result.findings = members.flatMap((run) => run.findings.map((finding) => ({ ...finding, slice_id: run.run_id })));
  result.coverage = { status: members.some((run) => run.coverage.status === 'partial') ? 'partial' : 'observed', issues: uniqueSorted(members.flatMap((run) => run.coverage.issues)) };
  result.configuration_fingerprint = digest(legacyJson(uniqueSorted(members.map((run) => run.configuration_fingerprint))));
  result.configuration_basis = 'explicit_group_not_single_effective_version';
  result.metrics = { member_runs: members.length, diagnostic_model_calls: 0, spawn_attempts: members.reduce((sum, run) => sum + run.metrics.spawn_attempts, 0), spawn_failed: members.reduce((sum, run) => sum + run.metrics.spawn_failed, 0), first_pass: { numerator: 0, denominator: 0 } };
  const changes = new Map();
  for (const run of [...members].sort((a, b) => a.collected_at.localeCompare(b.collected_at))) if (run.sdd?.change_id) changes.set(run.sdd.change_id, run);
  result.sdd = { association: 'explicit_group', tasks: [...changes.values()].flatMap((run) => run.sdd.tasks), events: [...changes.values()].flatMap((run) => run.sdd.events) };
  for (const run of changes.values()) {
    result.metrics.first_pass.numerator += run.metrics.first_pass.numerator;
    result.metrics.first_pass.denominator += run.metrics.first_pass.denominator;
  }
  return result;
}
