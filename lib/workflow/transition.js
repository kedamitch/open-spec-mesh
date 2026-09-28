import path from 'node:path';
import { readTextCompat, sha256 } from '../runtime/text.js';
import { withProjectLock } from '../runtime/locks.js';
import { graphSchema } from '../runtime/graph-schema.js';
import { context, document, contractDigest, revision, ancestor, event, saveGraph, validateDelivery, frozenContractDrifts } from './contract.js';
import { planningComplete } from './readiness.js';
import { acceptanceBlockers } from './evidence.js';

export function invalidationSet(root, changeId, graph, target) {
  const affected = new Set([target, ...frozenContractDrifts(root, changeId, graph)]);
  while (true) {
    const next = graph.tasks.filter((task) => task.depends_on.some((dep) => affected.has(dep))).map((task) => task.id);
    const before = affected.size;
    for (const id of next) affected.add(id);
    if (affected.size === before) return affected;
  }
}

export function transition(root, changeId, taskId, action, reason = '', { workersStopped = false, userConfirmed = false } = {}) {
  const c = context(root, changeId, taskId);
  const { change, fields, graphPath, graph, task, directory, taskFields } = c;
  const current = () => contractDigest(root, change, fields, directory, taskFields);
  const stale = frozenContractDrifts(root, changeId, graph);
  if (['approve', 'rework'].includes(action) && stale.size) throw new Error(`Frozen contract changed; stop and obtain user confirmation before replan: ${[...stale].sort().join(', ')}`);
  if (action === 'replan') {
    if (!userConfirmed) throw new Error('Replan requires explicit user confirmation: --user-confirmed');
    if (!stale.size) throw new Error('Contract is unchanged; use ordinary rework, not replan');
  }
  if (action === 'approve') {
    if (task.state !== 'planned') throw new Error('Approve Contract before execution');
    planningComplete(root, change, fields, directory, taskFields);
    task.contract_digest = current();
  } else if (action === 'submit') {
    if (task.state !== 'running') throw new Error('Only running tasks can submit');
    if (task.contract_digest !== current()) throw new Error('Frozen Contract changed; Main must request user-confirmed replan');
    const report = readTextCompat(document(root, directory, taskFields, 'report'));
    const taskContract = readTextCompat(document(root, directory, taskFields, 'contract'));
    const sha = validateDelivery(root, task, report, taskContract, path.relative(root, document(root, directory, taskFields, 'contract')));
    task.result_revision = sha;
    task.report_digest = sha256(Buffer.from(report, 'utf8'));
    event(task, 'submitted', { revision: sha, attempt: task.attempt ?? 0 });
  } else if (['rework', 'replan', 'block'].includes(action)) {
    if (!String(reason).trim()) throw new Error('A reason is required');
    const affected = invalidationSet(root, changeId, graph, taskId);
    const live = graph.tasks.filter((item) => affected.has(item.id) && item.state === 'running').map((item) => item.id);
    if (live.length && !workersStopped) throw new Error(`Stop affected workers first, then pass --workers-stopped: ${live.join(', ')}`);
    for (const item of graph.tasks) {
      if (!affected.has(item.id)) continue;
      const previous = {};
      for (const key of ['state', 'baseline', 'workspace', 'result_revision', 'report_digest', 'contract_digest', 'attempt', 'agent_session']) if (Object.hasOwn(item, key)) previous[key] = item[key];
      const remove = action === 'block' ? ['result_revision', 'report_digest'] : ['baseline', 'result_revision', 'report_digest', 'contract_digest'];
      for (const key of remove) delete item[key];
      event(item, action === 'block' ? 'blocked' : 'planned', {
        action, reason, invalidated_by: taskId, previous,
        user_confirmed: action === 'replan' && userConfirmed,
      });
    }
  } else throw new Error('Unknown transition');
  saveGraph(graphPath, graph);
  return task.state;
}

export async function transitionLocked(root, changeId, taskId, action, reason = '', options = {}) {
  return withProjectLock(root, () => transition(root, changeId, taskId, action, reason, options));
}
