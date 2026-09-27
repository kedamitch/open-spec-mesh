"""Evidence rules, not model-written explanations. Absence never proves intention."""
from __future__ import annotations

from collections import Counter
from datetime import datetime

from . import VERSION


def reference(event: dict) -> str:
    return event.get('source', 'unknown') + ':' + (event.get('locator') or 'L' + str(event.get('line', 0)))


def diagnose(run: dict) -> dict:
    events, findings = run['events'], []
    trace_full = run.get('host', {}).get('native_trace', 'full') == 'full'
    tools = [e for e in events if e['kind'] == 'tool']
    mode = run['expectation']['mode']
    sdd = run['sdd']
    calls = [e for e in tools if e['fact']['kind'] == 'agent.spawn']
    def add(rule, category, conclusion, evidence, action):
        findings.append({'rule': rule, 'category': category, 'conclusion': conclusion,
                         'evidence': sorted(set(evidence)), 'action': action})
    # Positive failed calls are facts. Failure text/prompt arguments are never copied.
    for call in calls:
        if call['status'] == 'failed':
            add('D01', 'observed_failure', f"{call['fact'].get('role')} 委派已尝试但返回失败；不是未调用。",
                [reference(call)], '检查该次工具响应、角色注册和运行时错误；不要先增加“必须调用”提示词。')
    policies = [p for session in run['sessions'] if session['id'] == run['root_session'] for p in session['policies']]
    restricted = [p for p in policies if p['signal'] == 'explorer_requires_complex']
    conflicting = any(p['signal'] == 'unrecognized_explorer_rule' for p in policies)
    current_restrictions = [p for p in run['snapshots'] if p.get('policy') == 'explorer_requires_complex']
    for role in run['expectation']['roles']:
        role_calls = [e for e in calls if e['fact'].get('role') == role]
        if role_calls or not trace_full:
            continue
        if role in {'explorer', 'librarian'} and mode in {'quick', 'sdd', 'simple'} and (restricted or current_restrictions) and not conflicting:
            basis = '运行时指令中' if restricted else '当前文件中（不证明该轮已加载）'
            evidence = [reference(p) for p in restricted] or [p['path'] + '@' + p['digest'][:12] for p in current_restrictions]
            add('D02', 'policy_restriction', f'{basis}，Explorer/Librarian 被旧规则限定在已批准 Complex；与当前 Quick/SDD 的调查权限冲突。',
                evidence, '先复核是否要把“调查委派”与“Complex 设计审批”解耦；不自动修改规则，也不把缺少委派判成模型失误。')
        else:
            add('D03', 'needs_review', f'操作者期望 {role}，选定执行范围未观察到其 spawn；必要性及工具可用性不能由缺席推断。',
                ['expectation:operator', 'coverage:' + run['coverage']['status']],
                '核对实际工具目录、审批和决策当时的信息缺口；补齐证据后再判断是否属于漏调。')
    # No mandatory extra declaration by the model. Expectations are optional operator annotations.
    executed = [e for e in tools if e['status'] == 'success']
    workflow = [e for e in executed if e['fact']['kind'].startswith(('change.', 'task.', 'design.'))]
    if mode in {'sdd', 'simple', 'complex'}:
        if trace_full and not workflow and sdd['association'] == 'unknown':
            add('S01', 'needs_review', '本次期望使用 SDD，但未观察到成功的 SDD 命令，且没有唯一 Change 关联。',
                ['expectation:operator', 'coverage:' + run['coverage']['status']],
                '先补充 --change 或完整 rollout；不能仅凭“无日志”断言没有按 SDD 执行。')
        if sdd.get('status') == 'not_found':
            add('S02', 'artifact_gap', '显式指定的 Change 在当前项目的进行中/已完成目录均不存在。',
                ['change:' + sdd['change_id']],
                '核对项目/分支/Change 标识，确认是否在实现后才补文档；当前文件状态不代表历史状态。')
    failed_workflow = [e for e in tools if e['status'] == 'failed' and e['fact']['kind'].startswith(('task.', 'change.'))]
    for event in failed_workflow:
        add('S03', 'observed_failure', f"SDD 命令 {event['fact']['kind']} 实际失败。",
            [reference(event)], '检查该事件的本地原始结果；不要把调用过 Skill/脚本等同于完成该阶段。')
    # Only compare positively observed, same-identity stage events. Never infer missing prerequisites.
    by_task = {}
    for event in executed:
        fact = event['fact']
        if fact.get('change_id') and fact.get('task_id') and event['at']:
            by_task.setdefault((fact['change_id'], fact['task_id']), []).append(event)
    for identity, entries in by_task.items():
        for before, after in [('task.prepare', 'task.submit'), ('task.submit', 'task.accept')]:
            a = [e for e in entries if e['fact']['kind'] == before]
            b = [e for e in entries if e['fact']['kind'] == after]
            # Rework creates valid repeated cycles: restrict this check to a single witnessed pair.
            if len(a) == len(b) == 1 and b[0]['at'] < a[0]['at']:
                add('S04', 'needs_review', f'{identity[1]} 观察到 {after} 早于 {before}；需核实是否跨 attempt 或错误排序。',
                    [reference(a[0]), reference(b[0])], '用对应 attempt 的 Task history 核对，不允许仅由时序提示自动 replan。')
    if mode in {'sdd', 'simple', 'complex'}:
        writes = [e for e in events if (e['kind'] == 'implementation.write' or e.get('fact', {}).get('kind') == 'implementation.write') and e.get('status') == 'success' and e['at']]
        creates = [e for e in workflow if e['fact']['kind'] == 'change.create' and e['at']]
        if len(creates) == 1 and writes and min(e['at'] for e in writes) < creates[0]['at']:
            earliest = min(writes, key=lambda e: e['at'])
            add('S05', 'needs_review', '记录到成功代码写入早于本轮 Change 创建；可能存在先实现后补契约。',
                [reference(earliest), reference(creates[0])], '核实写入是否属于同一需求或既有 Change；确定后再修正入口顺序，不自动判违规。')
        if sdd.get('graph') == 'absent' and any(e['status'] == 'success' and e['fact'].get('role') == 'worker' for e in calls):
            add('S06', 'artifact_gap', '已观察到 Worker 委派，但显式关联 Change 当前没有 Task Graph。',
                [sdd['source']] + [reference(e) for e in calls if e['fact'].get('role') == 'worker'],
                '检查 Task/Change 关联或缺失工件；纯文档 Change 不强制建 Task。')
    session_roles = {session['id']: session['role'] for session in run['sessions']}
    for call in calls:
        caller = session_roles.get(call['session'])
        if caller in {'worker', 'reviewer', 'explorer', 'librarian'}:
            add('D04', 'observed_action', f'观察到 {caller} 发起子代理委派。', [reference(call)],
                '对照该轮角色 Prompt 的叶子约束；职责应放在角色 Prompt/运行时，不扩写主 AGENTS.md。')
    # Reads are observations, not assertions that prompts were obeyed.
    skill_reads = [e for e in executed if e['fact']['kind'] == 'skill.read']
    if trace_full and mode in {'sdd', 'simple', 'complex'} and not skill_reads:
        add('P01', 'unknown', '未观察到成功的显式 SKILL.md 读取；不能据此判断 Skill 未加载或未执行。',
            ['coverage:' + run['coverage']['status']],
            '检查隐式加载/注入和真实工件。AGENTS 自动加载也不要求出现 cat 调用。')
    duplicates = Counter(p['instruction_digest'] for p in run['snapshots'] if p.get('instruction_digest') and p['path'].endswith('AGENTS.md'))
    for checksum, count in duplicates.items():
        if count > 1:
            add('P02', 'configuration_candidate', '当前全局与项目 AGENTS.md 含相同全文，存在重复规则候选。',
                [p['path'] + '@' + checksum[:12] for p in run['snapshots'] if p.get('instruction_digest') == checksum],
                '项目文件只保留工程差异；先核对实际指令链，不把当前重复文件直接认定为运行时重复 Token。')
    if conflicting:
        add('P03', 'unknown', '记录中存在未识别或变化后的 Explorer 路由规则，停止自动归因。',
            [reference(p) for p in policies], '比较对应规则版本；脚本不从自然语言推导权限覆盖关系。')
    if run['coverage']['issues']:
        add('C01', 'unknown', '执行证据覆盖不完整；缺失与未知不会计为通过或零开销。',
            ['coverage:' + x for x in run['coverage']['issues']], '补齐子会话/结束事件或升级适配器；不生成模型解释。')
    history = sdd['events']
    direct_rework = [e for e in history if e.get('action') == 'rework' and e.get('direct') is True]
    accepted = [t for t in sdd['tasks'] if t['state'] == 'accepted']
    eligible = [t for t in accepted if t.get('attempt') is not None and any(e['task_id'] == t['id'] and e['state'] == 'submitted' for e in history)]
    first_pass = sum(t['attempt'] == 1 and not any(e['task_id'] == t['id'] for e in direct_rework) for t in eligible)
    root_events = [e for e in events if e['session'] == run['root_session']]
    start = next((e['at'] for e in root_events if e['kind'] == 'turn.start'), None)
    end = next((e['at'] for e in reversed(root_events) if e['kind'] == 'turn.end'), None)
    duration = None
    if start and end:
        delta = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()
        duration = delta if delta >= 0 else None
    known_usage = [s['usage'] for s in run['sessions'] if s['usage'] is not None]
    usage = {k: sum(u[k] for u in known_usage) if all(k in u for u in known_usage) else None
             for k in ('input_tokens', 'cached_input_tokens', 'output_tokens')} if known_usage else None
    metrics = {
        'sessions_observed': len(run['sessions']), 'spawn_attempts': len(calls),
        'spawn_success': sum(c['status'] == 'success' for c in calls),
        'spawn_failed': sum(c['status'] == 'failed' for c in calls),
        'spawn_unknown': sum(c['status'] == 'unknown' for c in calls),
        'resume_attempts': sum(e['fact']['kind'] == 'agent.resume' for e in tools),
        'local_read_commands': sum(e['fact']['kind'] == 'local.read' for e in executed),
        'skill_read_commands': len(skill_reads), 'sdd_successful_commands': len(workflow),
        'tasks_observed': len(sdd['tasks']), 'tasks_currently_accepted': len(accepted),
        'first_pass': {'numerator': first_pass, 'denominator': len(eligible)},
        'direct_rework': len(direct_rework),
        'dependency_invalidations': sum(e.get('action') == 'rework' and e.get('direct') is False for e in history),
        'replan_events': sum(e.get('action') == 'replan' and e.get('direct') is True for e in history),
        'wall_seconds': duration, 'usage_observed': usage,
        'usage_coverage': {'numerator': len(known_usage), 'denominator': len(run['sessions'])},
        'diagnostic_model_calls': 0,
    }
    return {**run, 'analyzer_version': VERSION, 'findings': findings, 'metrics': metrics}


def cell(value) -> str:
    return str(value if value is not None else 'unknown').replace('|', '\\|').replace('\n', ' ').replace('`', "'").replace('<', '&lt;').replace('>', '&gt;')


def markdown(run: dict) -> str:
    host = run.get('host', {'name': 'codex', 'native_trace': 'full'})
    lines = ['# 执行行为诊断', '', f"Run：`{cell(run['run_id'])}`；Host：`{cell(host.get('name'))}`；native trace：`{cell(host.get('native_trace'))}`；规则集：`{VERSION}`；额外模型调用：**0**。" + (' 分组成员：' + ', '.join(run['members']) if run.get('members') else ''), '',
             f"选定会话：`{cell(run['root_session'])}`；Turn：`{cell(run['turn'])}`；期望模式：`{cell(run['expectation']['mode'])}`（操作者标注，不是模型事实）。", '',
             '## 诊断', '', '| 规则 / 分类 | 结论 | 证据定位 | 最小修正建议 |', '| --- | --- | --- | --- |']
    for f in run['findings']:
        lines.append('| ' + ' | '.join(cell(v) for v in (f['rule'] + ' / ' + f['category'], f['conclusion'], '; '.join(f['evidence']), f['action'])) + ' |')
    if not run['findings']:
        lines.append('| — | 已支持的规则未发现问题；不代表语义正确或全面合规。 | 当前观测 | 保留固定回归任务。 |')
    lines += ['', '## 委派与会话', '', '| Slice | Session | Parent | Role | 实际 Model / Effort | 用量可归因 |', '| --- | --- | --- | --- | --- | --- |']
    for s in run['sessions']:
        lines.append('| ' + ' | '.join(cell(v) for v in (s.get('slice_id', run['run_id']), s['id'], s['parent'], s['role'], str(s['model']) + ' / ' + str(s['effort']), s['usage'] is not None)) + ' |')
    lines += ['', '## 时间线', '', '| 时间 | Session | 事件 | 结果 | 证据 |', '| --- | --- | --- | --- |']
    for e in sorted(run['events'], key=lambda x: (x['at'] or '', x['source'], x['line'])):
        kind = e.get('fact', {}).get('kind', e['kind'])
        if kind in {'usage.total', 'context', 'other.command', 'other.tool', 'local.read', 'opaque'}:
            continue
        lines.append('| ' + ' | '.join(cell(v) for v in (e['at'], e['session'], kind, e.get('status', e.get('outcome')), reference(e))) + ' |')
    lines += ['', '## SDD 状态历史', '', '| Task | State / Action | Attempt | 原始时间 | 证据 |', '| --- | --- | --- | --- |']
    for e in run['sdd']['events']:
        lines.append('| ' + ' | '.join(cell(v) for v in (e['task_id'], str(e['state']) + ' / ' + str(e.get('action')), e.get('attempt'), e['at'], reference(e))) + ' |')
    lines += ['', '## 指标', '', '| 指标 | 值 |', '| --- | --- |']
    for key, value in run['metrics'].items():
        lines.append(f'| {key} | {cell(value)} |')
    lines += ['', '首轮通过率以可归因且已验收 Task 为分母，不包含运行中/未知任务；直接返工与下游失效分开。',
              '用量是已观测范围的累计差值，不反复累加 cumulative counter；子会话缺少起始基线时为 unknown，不估算账单。', '',
              '## 配置版本与覆盖', '', f"当前配置指纹：`{run['configuration_fingerprint']}`（事后文件清单，不证明该轮已加载）。", '',
              '| 文件 | 状态 | 指纹 |', '| --- | --- | --- |']
    lines += [f"| {cell(s['path'])} | {cell(s['status'])} | {cell(s.get('digest'))} |" for s in run['snapshots']]
    lines += ['', '覆盖问题：' + (', '.join(run['coverage']['issues']) or '未发现已支持格式的覆盖缺口；仍不证明日志包含全部运行行为。'), '',
              '脚本不读取思维链来推断原因，不保存原始对话/工具输出/源码，不自动改 AGENTS.md、角色 Prompt 或 Skill。',
              'unknown、needs_review 是待核实而非违规。自然语言需求、委派必要性、提示词因果贡献不由本脚本判定。', '']
    return '\n'.join(lines)


def summary(runs: list[dict]) -> str:
    lines = ['# 行为诊断版本汇总', '', '不同模式和配置指纹分组；仅描述关联，不宣称提示词改动导致结果变化。', '',
             '| 期望模式 / 配置指纹（事后） | Run 数 | 覆盖不足 | 委派失败 | 首轮通过 Task / 可评 Task |', '| --- | --- | --- | --- | --- |']
    groups = {}
    # A Change snapshot may appear in several slices. Attribute its latest observation
    # once, rather than counting the same accepted Task for every turn.
    latest_changes = {}
    for run in sorted((r for r in runs if not r.get('members')), key=lambda r: r['collected_at']):
        change = run['sdd'].get('change_id')
        if change:
            latest_changes[(run['project_key'], change)] = run
    for run in runs:
        if run.get('members'):
            continue  # groups are views; don't count them again as new executions
        groups.setdefault((run['expectation']['mode'], run['configuration_fingerprint']), []).append(run)
    for key, members in sorted(groups.items()):
        snapshots = [r for r in latest_changes.values() if (r['expectation']['mode'], r['configuration_fingerprint']) == key]
        first = sum(r['metrics']['first_pass']['numerator'] for r in snapshots)
        eligible = sum(r['metrics']['first_pass']['denominator'] for r in snapshots)
        lines.append('| ' + ' | '.join(map(cell, (key[0] + ' / ' + key[1][:16], len(members), sum(r['coverage']['status'] == 'partial' for r in members), sum(r['metrics']['spawn_failed'] for r in members), f'{first}/{eligible}'))) + ' |')
    counts = Counter((f['rule'], f['category']) for r in runs if not r.get('members') for f in r['findings'])
    lines += ['', '## 重复问题', '', '| 规则 / 分类 | 事件数 |', '| --- | --- |']
    lines += [f'| {cell(k[0])} / {cell(k[1])} | {v} |' for k, v in sorted(counts.items())]
    lines += ['', 'Task 指标按项目与 Change 的最新工件快照去重，不按每轮重复累计；分配到最新观测的配置组不代表因果归属。', '当前版本不进行自动因果归因、综合打分或模型复审；比较需使用相同任务样本和完整证据。', '']
    return '\n'.join(lines)


def group_runs(members: list[dict]) -> dict:
    """Explicit demand-level grouping; never guess that two turns are one request.

    Reports remain per-slice evidence. Overlapping selections are rejected instead
    of double-counting cumulative usage. Latest artifact snapshot wins per Change.
    """
    from copy import deepcopy
    from .trace import digest
    import json
    if not members or any(r.get('members') for r in members):
        raise ValueError('Group needs flat collected runs, not nested groups')
    if len({r['project_key'] for r in members}) != 1:
        raise ValueError('Cannot group different projects')
    scopes = {(r['root_session'], r['turn']) for r in members}
    if len(scopes) != len(members):
        raise ValueError('Overlapping root session/turn selections cannot be grouped')
    event_keys = set()
    for run in members:
        keys = {(e['source'], e['line']) for e in run['events'] if e['kind'] not in {'context'}}
        if event_keys & keys:
            raise ValueError('Overlapping child event ranges cannot be grouped')
        event_keys |= keys
    latest = max(members, key=lambda r: r['collected_at'])
    result = deepcopy(latest)
    result['members'] = [r['run_id'] for r in members]
    modes = {r['expectation']['mode'] for r in members}
    result['expectation'] = {'mode': next(iter(modes)) if len(modes) == 1 else 'unknown', 'roles': sorted({role for r in members for role in r['expectation']['roles']}), 'source': 'explicit_member_group'}
    result['root_session'] = 'multiple'
    result['turn'] = None
    result['events'] = [e for r in members for e in r['events']]
    result['sessions'] = [dict(s, slice_id=r['run_id']) for r in members for s in r['sessions']]
    result['findings'] = [dict(f, slice_id=r['run_id']) for r in members for f in r['findings']]
    result['coverage'] = {'status':'partial' if any(r['coverage']['status']=='partial' for r in members) else 'observed',
                          'issues':sorted({x for r in members for x in r['coverage']['issues']})}
    result['configuration_fingerprint'] = digest(json.dumps(sorted({r['configuration_fingerprint'] for r in members})))
    result['configuration_basis'] = 'explicit_group_not_single_effective_version'
    result['metrics'] = {'member_runs':len(members), 'diagnostic_model_calls':0,
                         'spawn_attempts':sum(r['metrics']['spawn_attempts'] for r in members),
                         'spawn_failed':sum(r['metrics']['spawn_failed'] for r in members),
                         'first_pass':{'numerator':0,'denominator':0}}
    # Do not sum the same Task history observed in several slices.
    changes = {}
    for run in sorted(members, key=lambda r:r['collected_at']):
        if run['sdd'].get('change_id'):
            changes[run['sdd']['change_id']] = run
    result['sdd'] = {'association':'explicit_group', 'tasks':[t for r in changes.values() for t in r['sdd']['tasks']],
                     'events':[e for r in changes.values() for e in r['sdd']['events']]}
    for run in changes.values():
        for key in ('numerator','denominator'):
            result['metrics']['first_pass'][key] += run['metrics']['first_pass'][key]
    return result
