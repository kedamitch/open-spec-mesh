import { createHash } from 'node:crypto';
import { isLosslessNumber } from 'lossless-json';
import path from 'node:path';
import { openSync, closeSync, writeFileSync, lstatSync, readFileSync } from 'node:fs';
import { context, document, contractDigest, revision, ancestor, event, git, saveGraph, readTextCompat, writeSpec, validateDelivery, frozenContractDrifts } from './contract.js';
import { planningComplete } from './readiness.js';
import { taskAcRefs, changedFiles, validateEvidence, acceptanceBlockers } from './evidence.js';
import { validateChangedPaths } from './path-contract.js';
import { transition, invalidationSet } from './transition.js';
import { prepareWorkspace, sharedWorktree } from './workspace.js';
import { withProjectLock } from '../runtime/locks.js';
import { safeInside } from '../runtime/paths.js';

function attemptMatches(value, expected) {
  const raw = isLosslessNumber(value) ? value.toString() : String(value);
  const wanted = isLosslessNumber(expected) ? expected.toString() : String(expected);
  return raw === wanted;
}
export function selectTask(root, changeId, taskId = null) {
  if (taskId) return context(root, changeId, taskId).task.id;
  const graph = context(root, changeId).graph;
  if (graph.tasks.length === 1) return graph.tasks[0].id;
  if (graph.tasks.length > 1) throw new Error('Multiple Tasks: select --task explicitly');
  throw new Error('No Task Graph: use Quick for Main-owned work, or have Architect define an SDD Task Graph before prepare');
}
export function integrationState(root, task) {
  if (task.state !== 'accepted') return 'not_applicable';
  return ancestor(root, task.result_revision, revision(root, 'HEAD')) ? 'integrated' : 'pending';
}
export function dependencyIntegrationWaiting(root, graph, task) {
  const head = revision(root, 'HEAD');
  const byId = new Map(graph.tasks.map((item) => [item.id, item]));
  return task.depends_on.filter((dep) => byId.get(dep).state === 'accepted' && !ancestor(root, byId.get(dep).result_revision, head));
}
export function taskActionState(root, changeId, taskId, { planningReady = true } = {}) {
  const { graph, task } = context(root, changeId, taskId);
  const waiting = task.depends_on.filter((dep) => graph.tasks.find((item) => item.id === dep).state !== 'accepted');
  const integrationWaiting = dependencyIntegrationWaiting(root, graph, task);
  const stale = frozenDrifts(root, changeId, graph);
  const actions = [];
  const blockers = [];
  if (stale.has(taskId)) return { allowed_actions: ['request_replan_confirmation'], blocked_reasons: [`frozen_contract_changed:${taskId}`] };
  if (task.state === 'planned') {
    if (stale.size) { actions.push('request_replan_confirmation'); blockers.push(`frozen_contract_changed:${[...stale].sort().join(',')}`); }
    else if (!planningReady) { actions.push('resume_architect'); blockers.push('planning_incomplete'); }
    else if (waiting.length) blockers.push(`waiting_for_dependencies:${waiting.join(',')}`);
    else if (integrationWaiting.length) blockers.push(`waiting_for_integrated_dependencies:${integrationWaiting.join(',')}`);
    else actions.push('prepare');
  } else if (task.state === 'running') {
    if (!task.agent_session) actions.push('bind_session');
    actions.push('resume_worker', 'deliver');
  } else if (task.state === 'submitted') {
    actions.push('accept');
    if (stale.size) { actions.push('request_replan_confirmation'); blockers.push(`rework_blocked_by_contract_drift:${[...stale].sort().join(',')}`); }
    else actions.push('rework');
  } else if (task.state === 'accepted' || task.state === 'blocked') {
    if (stale.size) { actions.push('request_replan_confirmation'); blockers.push(`rework_blocked_by_contract_drift:${[...stale].sort().join(',')}`); }
    else { if (task.state === 'accepted' && integrationState(root, task) === 'pending') actions.push('integrate'); actions.push('rework'); }
  }
  return { allowed_actions: actions, blocked_reasons: blockers };
}
function frozenDrifts(root, changeId, graph) {
  // Imported lazily to avoid a circular initialization through transition.js.
  return frozenContractDrifts(root, changeId, graph);
}
export function taskActions(root, changeId, taskId, options) { return taskActionState(root, changeId, taskId, options).allowed_actions; }
export function status(root, changeId, taskId = null) {
  const base = context(root, changeId);
  let planningError = null;
  try { planningComplete(base.root, base.change, base.fields); } catch (error) { planningError = error.message; }
  const selected = taskId ? [context(root, changeId, taskId).task] : base.graph.tasks;
  const summaries = selected.map((task) => ({
    task: task.id, state: task.state, depends_on: task.depends_on,
    waiting_on: task.depends_on.filter((dep) => base.graph.tasks.find((item) => item.id === dep).state !== 'accepted'),
    ...(task.attempt !== undefined ? { attempt: task.attempt } : {}),
    ...(task.workspace !== undefined ? { workspace: task.workspace } : {}),
    ...(task.agent_session !== undefined ? { agent_session: task.agent_session } : {}),
    integration: integrationState(base.root, task),
    ...taskActionState(base.root, changeId, task.id, { planningReady: !planningError }),
  }));
  return { change: changeId, graph_ready: true, planning_ready: !planningError, planning_error: planningError, tasks: summaries };
}
export function workerDispatchPacket(root, changeId, taskId, resume = false) {
  const { change, fields, graph, task, directory, taskFields } = context(root, changeId, taskId);
  const byId = new Map(graph.tasks.map((item) => [item.id, item]));
  const artifacts = {
    change: document(root, change, fields, 'contract'),
    task_contract: document(root, directory, taskFields, 'contract'),
    delivery: document(root, directory, taskFields, 'report'),
  };
  if (fields.design) artifacts.design = document(root, change, fields, 'design');
  return {
    role: 'worker', mode: 'sdd', resume,
    goal: `执行冻结 Task ${taskId}，完成实现、测试、自审、修复、复验和 Delivery。`,
    artifacts,
    runtime: { baseline: task.baseline, attempt: task.attempt, workspace: task.workspace, contract_digest: task.contract_digest, agent_session: task.agent_session ?? null },
    dependencies: task.depends_on.map((dep) => ({ task: dep, state: byId.get(dep).state, revision: byId.get(dep).result_revision })),
    constraints: [
      '以 Task Contract 和其引用的 Design/Change 为准，不依赖调用方重新转述需求。',
      '实际 diff 必须符合当前 Task Path Contract；兄弟 Task 路径重叠不是越界。',
      '只运行当前 Task 的定向测试和必要 build/static check；不要反复运行项目全量测试。',
      '不得自行改变冻结 Contract、拆分 Task 或扩大授权范围。',
      '普通实现缺陷在当前执行上下文修复；设计缺口或契约变化必须停止并上报。',
    ],
    expected_output: ['revision', 'changed_files', 'verification', 'self_review', 'remaining_issues', 'delivery_report'],
  };
}
export function dispatchInfo(root, changeId, taskId, resume = false) {
  const { change, fields, task, directory, taskFields } = context(root, changeId, taskId);
  return {
    change: changeId, task: taskId, state: task.state, resume,
    contract: document(root, change, fields, 'contract'),
    task_contract: document(root, directory, taskFields, 'contract'),
    report: document(root, directory, taskFields, 'report'),
    agent_session: task.agent_session ?? null,
    allowed_actions: taskActions(root, changeId, taskId),
    ...(fields.design ? { design: document(root, change, fields, 'design') } : {}),
    baseline: task.baseline, attempt: task.attempt, workspace: task.workspace, contract_digest: task.contract_digest,
    dispatch: workerDispatchPacket(root, changeId, taskId, resume),
  };
}
export async function bindSession(root, changeId, taskId, agentSession) {
  const session = typeof agentSession === 'string' ? agentSession.trim() : '';
  if (!session || session.length > 256 || /[\u0000-\u001f]/u.test(session)) throw new Error('agent_session must be a nonempty printable identifier up to 256 characters');
  let wasBound = false;
  await withProjectLock(root, () => {
    const { graphPath, graph, task } = context(root, changeId, taskId);
    if (task.state !== 'running') throw new Error('Bind a Worker session only while its Task is running');
    const existing = task.agent_session;
    if (existing && existing !== session) throw new Error('Task is already bound to a different Worker session');
    wasBound = Boolean(existing);
    task.agent_session = session;
    saveGraph(graphPath, graph);
  });
  return dispatchInfo(root, changeId, taskId, wasBound);
}
export async function prepare(root, changeId, taskId = null, { base = null, worktree = null, reuse = false } = {}) {
  taskId = selectTask(root, changeId, taskId);
  const current = context(root, changeId, taskId);
  if (current.task.state === 'running') {
    if (contractDigest(root, current.change, current.fields, current.directory, current.taskFields) !== current.task.contract_digest) throw new Error('Frozen Contract changed; request user-confirmed replan');
    const location = sharedWorktree(root, current.task.workspace);
    if (worktree && path.resolve(worktree) !== location) throw new Error('Resume the original Worker/workspace; do not dispatch a second writer');
    if (base && revision(root, base) !== current.task.baseline) throw new Error('A running Task cannot change its assigned baseline');
    return dispatchInfo(root, changeId, taskId, true);
  }
  await withProjectLock(root, () => transition(root, changeId, taskId, 'approve'));
  await prepareWorkspace(root, changeId, taskId, base ?? 'HEAD', worktree, reuse);
  return dispatchInfo(root, changeId, taskId, false);
}
function safeDestination(filename) {
  const target = path.resolve(filename);
  for (let cursor = target; ; cursor = path.dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Refusing symlink evidence destination'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
  return target;
}
export async function draftDelivery(root, changeId, taskId, result, attempt, evidenceFile) {
  return withProjectLock(root, () => {
    const { change, fields, task, directory, taskFields } = context(root, changeId, taskId);
    if (task.state !== 'running' || !attemptMatches(task.attempt, attempt) || path.resolve(task.workspace) !== path.resolve(root) || task.contract_digest !== contractDigest(root, change, fields, directory, taskFields)) throw new Error('Draft requires the current assigned workspace, frozen Contract and attempt');
    const sha = revision(root, result);
    if (!ancestor(root, task.baseline, sha)) throw new Error('Result must descend from assigned baseline');
    const files = changedFiles(root, task.baseline, sha);
    const contract = readTextCompat(document(root, directory, taskFields, 'contract'));
    validateChangedPaths(contract, files.keys(), path.relative(root, document(root, directory, taskFields, 'contract')));
    const fileRows = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([filename, op]) => {
      if (/[|`\n\r]/u.test(filename)) throw new Error('Filename cannot be safely represented in this delivery table');
      return `| \`${filename}\` | ${op} | 待补充。 |`;
    });
    if (!fileRows.length) fileRows.push('|  |  |  |');
    const validationRows = taskAcRefs(contract).map((ac) => `| \`${ac}\` | 待补充。 | 待补充。 | 待补充。 |`);
    const body = `## 文件改动\n\n> **交付结果**：待补充。\n\n| 文件 | 操作 | 行为影响 |\n| --- | --- | --- |\n${fileRows.join('\n')}\n\n## 验证结果\n\n- **结论**：待补充。\n\n| AC / 场景 | 检查 | 结果 | 证据 |\n| --- | --- | --- | --- |\n${validationRows.join('\n')}\n\n## 自审结论\n\n- **已修复问题**：无\n- **契约偏差**：无\n\n## 剩余问题\n\n- **未验证项**：无\n- **剩余风险**：无\n\n## 快照影响\n\n- **范围**：待补充。\n- **说明**：待补充。\n`;
    const target = safeDestination(evidenceFile);
    const fd = openSync(target, 'wx', 0o600);
    try { writeFileSync(fd, body, 'utf8'); } finally { closeSync(fd); }
    return { change: changeId, task: taskId, status: 'draft', evidence_file: target, revision: sha, attempt: task.attempt, task_state: 'running' };
  });
}
export async function deliver(root, changeId, taskId = null, { result = 'HEAD', attempt, evidenceFile, draft = false } = {}) {
  taskId = selectTask(root, changeId, taskId);
  if (draft) return draftDelivery(root, changeId, taskId, result, attempt, evidenceFile);
  const evidence = readTextCompat(evidenceFile);
  return withProjectLock(root, () => {
    const { change, fields, task, directory, taskFields } = context(root, changeId, taskId);
    const digest = contractDigest(root, change, fields, directory, taskFields);
    if (task.state !== 'running' || task.contract_digest !== digest) throw new Error('Task is not running with the frozen Contract');
    const sha = revision(root, result);
    if (!ancestor(root, task.baseline, sha)) throw new Error('Result must descend from assigned baseline');
    if (path.resolve(task.workspace) !== path.resolve(root)) throw new Error('Delivery must be written in the assigned workspace');
    if (!attemptMatches(task.attempt, attempt)) throw new Error('Stale assigned attempt; request a new dispatch before recording');
    const taskContractPath = document(root, directory, taskFields, 'contract');
    validateEvidence(root, task.baseline, sha, evidence, readTextCompat(taskContractPath), path.relative(root, taskContractPath));
    const report = document(root, directory, taskFields, 'report');
    writeSpec(report, { status: 'submitted', revision: sha, attempt: String(task.attempt ?? 0), contract_digest: digest, baseline: task.baseline }, `\n# 任务交付报告\n\n${evidence.trim()}\n`);
    return { change: changeId, task: taskId, status: 'report-written', report, task_state: 'running' };
  });
}
export async function accept(root, changeId, taskId, decision, reason, workersStopped = false) {
  if (!['accept', 'rework'].includes(decision)) throw new Error('Unknown acceptance decision');
  if (!reason?.trim()) throw new Error('Acceptance evidence/feedback required');
  return withProjectLock(root, () => {
    if (decision === 'rework') return transition(root, changeId, taskId, 'rework', reason, { workersStopped });
    const { change, fields, graphPath, graph, task, directory, taskFields } = context(root, changeId, taskId);
    const report = readTextCompat(document(root, directory, taskFields, 'report'));
    if (task.state !== 'submitted' || shaText(report) !== task.report_digest) throw new Error('Submit the current report before acceptance');
    if (contractDigest(root, change, fields, directory, taskFields) !== task.contract_digest) throw new Error('Frozen Contract changed');
    const blockers = acceptanceBlockers(report, readTextCompat(document(root, directory, taskFields, 'contract')));
    if (blockers.length) throw new Error(`Delivery is not acceptance-ready: ${blockers.join(', ')}`);
    event(task, 'accepted', { reason, revision: task.result_revision });
    saveGraph(graphPath, graph);
    return 'accepted';
  });
}
function shaText(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

import { validateAcceptedTask } from './integration.js';
import { closeChange } from './closure.js';
import { atomicWrite } from '../runtime/io.js';

export async function importDelivery(root, changeId, taskId, source) {
  return withProjectLock(root, () => {
    const main = context(root, changeId, taskId);
    const location = sharedWorktree(root, path.resolve(source));
    if (location !== main.task.workspace) throw new Error("Delivery source is not this Task's assigned workspace");
    const expected = contractDigest(root, main.change, main.fields, main.directory, main.taskFields);
    if (main.task.state !== 'running' || expected !== main.task.contract_digest) throw new Error('Current Task is not running against its frozen Contract');
    const worker = context(location, changeId, taskId);
    if (contractDigest(location, worker.change, worker.fields, worker.directory, worker.taskFields) !== expected) throw new Error('Worker workspace contract is stale or modified');
    if (!attemptMatches(worker.task.attempt, main.task.attempt) || worker.task.baseline !== main.task.baseline) throw new Error('Worker scheduler snapshot belongs to an old dispatch');
    const report = readTextCompat(document(location, worker.directory, worker.taskFields, 'report'));
    const taskContractPath = document(root, main.directory, main.taskFields, 'contract');
    validateDelivery(root, main.task, report, readTextCompat(taskContractPath), path.relative(root, taskContractPath));
    const destination = document(root, main.directory, main.taskFields, 'report');
    const previous = readFileSync(destination);
    try {
      atomicWrite(destination, Buffer.from(report, 'utf8'), { preserveMode: true });
      return transition(root, changeId, taskId, 'submit');
    } catch (error) {
      atomicWrite(destination, previous, { preserveMode: true });
      throw error;
    }
  });
}
export async function close(root, changeId, taskId = null, { acceptTask = false, archive = false, reason = '', fromWorkspace = null } = {}) {
  if (!acceptTask && !archive) throw new Error('Choose --accept and/or --archive; no implicit acceptance');
  if (acceptTask && !reason.trim()) throw new Error('--accept requires the Main acceptance judgment in --reason');
  const result = { change: changeId };
  if (acceptTask) {
    taskId = selectTask(root, changeId, taskId);
    const c = context(root, changeId, taskId);
    if (fromWorkspace) {
      const source = sharedWorktree(root, path.resolve(fromWorkspace));
      if (source !== c.task.workspace) throw new Error('Delivery source is not the assigned workspace');
    }
    if (c.task.state === 'running') {
      const source = c.task.workspace;
      if (path.resolve(source) === path.resolve(root)) await withProjectLock(root, () => transition(root, changeId, taskId, 'submit'));
      else await importDelivery(root, changeId, taskId, source);
    }
    if (context(root, changeId, taskId).task.state === 'accepted') validateAcceptedTask(root, changeId, taskId);
    else await accept(root, changeId, taskId, 'accept', reason);
    Object.assign(result, { task: taskId, state: 'accepted' });
  }
  if (archive) Object.assign(result, { state: 'completed', path: String(await closeChange(root, changeId)) });
  return result;
}
