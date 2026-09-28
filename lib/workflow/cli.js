import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeError, writeLine } from '../cli/output.js';
import { legacyJson } from '../runtime/compat-json.js';
import { context, rootPath, saveGraph, contractDigest } from './contract.js';
import { graphSchema } from '../runtime/graph-schema.js';
import { withProjectLock } from '../runtime/locks.js';
import { transition } from './transition.js';
import { status, prepare, bindSession, deliver, close, selectTask } from './lifecycle.js';
import { integrate, integrateWave, integrationWaveCheck } from './integration.js';
import { prepareWorkspace } from './workspace.js';
import { runValidation } from './receipt.js';
import { planningComplete as planningCompleteImpl } from './readiness.js';
import { checkChange, closeChange } from './closure.js';

function parse(argv, positionals, options) { return parseArgs(argv, { positionals, options, command: 'sdd' }); }
function usage(action = '') {
  return `Usage: open-spec-mesh sdd ${action || '<status|prepare|bind-session|deliver|integrate|close>'} CHANGE_ID [options]\n`;
}
function required(value, flag) { if (value === undefined || value === '') throw new UsageError(`argument ${flag}: required`); }

export async function runSdd(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const [action, ...rest] = argv;
    if (!['status', 'prepare', 'bind-session', 'deliver', 'integrate', 'close'].includes(action)) throw new UsageError('action must be one of: status, prepare, bind-session, deliver, integrate, close');
    const common = { root: { kind: 'value', default: process.cwd() }, task: { kind: 'value' } };
    let args;
    if (action === 'status') args = parse(rest, ['change_id'], common);
    else if (action === 'prepare') args = parse(rest, ['change_id'], { ...common, base: { kind: 'value' }, worktree: { kind: 'value' }, reuse: { kind: 'boolean' } });
    else if (action === 'bind-session') args = parse(rest, ['change_id'], { ...common, 'agent-session': { kind: 'value' } });
    else if (action === 'deliver') args = parse(rest, ['change_id'], { ...common, revision: { kind: 'value', default: 'HEAD' }, attempt: { kind: 'value' }, 'evidence-file': { kind: 'value' }, draft: { kind: 'boolean' } });
    else if (action === 'integrate') args = parse(rest, ['change_id'], { ...common, check: { kind: 'boolean' }, wave: { kind: 'boolean' } });
    else args = parse(rest, ['change_id'], { ...common, accept: { kind: 'boolean' }, archive: { kind: 'boolean' }, reason: { kind: 'value', default: '' }, 'from-workspace': { kind: 'value' } });
    if (args.help) { stdout.write(usage(action)); return 0; }
    const root = rootPath(args.root);
    let result;
    if (action === 'status') result = status(root, args.change_id, args.task);
    else if (action === 'prepare') result = await prepare(root, args.change_id, args.task, { base: args.base, worktree: args.worktree, reuse: args.reuse });
    else if (action === 'bind-session') {
      required(args['agent-session'], '--agent-session');
      result = await bindSession(root, args.change_id, selectTask(root, args.change_id, args.task), args['agent-session']);
    } else if (action === 'deliver') {
      required(args.attempt, '--attempt'); required(args['evidence-file'], '--evidence-file');
      if (!/^[1-9][0-9]*$/u.test(args.attempt)) throw new UsageError('--attempt must be a positive integer');
      result = await deliver(root, args.change_id, args.task, { result: args.revision, attempt: args.attempt, evidenceFile: args['evidence-file'], draft: args.draft });
    } else if (action === 'integrate') {
      if (args.wave) {
        if (args.task) throw new UsageError('--wave and --task are mutually exclusive');
        result = await integrateWave(root, args.change_id, args.check);
      } else {
        const taskId = selectTask(root, args.change_id, args.task);
        result = await integrate(root, args.change_id, taskId, args.check);
      }
    } else {
      if (!args.accept && !args.archive) throw new UsageError('Choose --accept and/or --archive; no implicit acceptance');
      result = await close(root, args.change_id, args.task, { acceptTask: args.accept, archive: args.archive, reason: args.reason, fromWorkspace: args['from-workspace'] });
    }
    stdout.write(`${legacyJson(result, { ensureAscii: false, indent: 2 })}\n`);
    return 0;
  } catch (error) {
    writeError(error, stderr);
    return error instanceof UsageError ? error.exitCode : 1;
  }
}

export async function runTaskGraph(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, {
      positionals: [{ name: 'graph', required: false }],
      options: {
        root: { kind: 'value', default: process.cwd() }, change: { kind: 'value' }, task: { kind: 'value' },
        action: { kind: 'value' }, reason: { kind: 'value', default: '' }, 'workers-stopped': { kind: 'boolean' }, 'user-confirmed': { kind: 'boolean' },
      },
      command: 'task-graph',
    });
    if (args.help) { stdout.write('Usage: open-spec-mesh task-graph [GRAPH] [--root PROJECT] [--change ID --task ID --action ACTION]\n'); return 0; }
    const root = rootPath(args.root);
    if (args.action) {
      if (!args.change || !args.task) throw new UsageError('--change and --task required');
      const value = await withProjectLock(root, () => transition(root, args.change, args.task, args.action, args.reason, { workersStopped: args['workers-stopped'], userConfirmed: args['user-confirmed'] }));
      writeLine(value, stdout);
    } else {
      if (!args.graph) throw new UsageError('Graph path required');
      const graph = graphSchema.load(path.resolve(args.graph), { allowEmpty: false });
      stdout.write(`${legacyJson(summarizeGraph(graph), { ensureAscii: false, indent: 2 })}\n`);
    }
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
function summarizeGraph(graph) {
  const byId = new Map(graph.tasks.map((task) => [task.id, task]));
  const ready = [], active = [], blocked = Object.create(null);
  for (const task of graph.tasks) {
    const waiting = task.depends_on.filter((dep) => byId.get(dep).state !== 'accepted');
    if (['running', 'submitted', 'accepted'].includes(task.state) && waiting.length) throw new Error(`${task.id}: dependencies must be accepted before execution.`);
    if (task.state === 'blocked') blocked[task.id] = 'state=blocked';
    else if (waiting.length) blocked[task.id] = `waiting_for_dependencies: ${waiting.join(', ')}`;
    else if (task.state === 'planned') ready.push(task.id);
    else if (['running', 'submitted'].includes(task.state)) active.push(task.id);
  }
  return { ready, active, blocked };
}

export const planningComplete = planningCompleteImpl;
export const readContractDigest = contractDigest;
export { runValidation, checkChange, closeChange };
