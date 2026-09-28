import { atomicWrite } from './io.js';
import { readTextCompat } from './text.js';
import { parseLosslessJson, legacyJson } from './compat-json.js';
import { isLosslessNumber } from 'lossless-json';

const STATES = new Set(['planned', 'running', 'submitted', 'accepted', 'blocked']);
const FIELDS = new Set(['id', 'depends_on', 'state', 'result_revision', 'path', 'history', 'contract_digest', 'report_digest', 'workspace', 'baseline', 'attempt', 'agent_session']);
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const NONEMPTY_STRING_FIELDS = ['contract_digest', 'report_digest', 'baseline', 'workspace', 'agent_session'];

function validAttempt(value) {
  if (isLosslessNumber(value)) {
    const raw = value.toString();
    return /^-?(?:0|[1-9][0-9]*)$/u.test(raw) && BigInt(raw) >= 1n;
  }
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function validateGraph(data, { allowEmpty = true } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || !Array.isArray(data.tasks)) {
    throw new Error('A task graph contains only a tasks array.');
  }
  if (!allowEmpty && data.tasks.length === 0) throw new Error('Use a non-empty tasks array, or omit the graph.');
  const byId = new Map();
  for (const task of data.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) || Object.keys(task).some((key) => !FIELDS.has(key))) throw new Error('Invalid task fields.');
    if (!Object.hasOwn(task, 'id') || !Object.hasOwn(task, 'depends_on') || !Object.hasOwn(task, 'state')) throw new Error('Task requires id, depends_on and state.');
    if (typeof task.id !== 'string' || !ID.test(task.id)) throw new Error('Invalid task id.');
    if (byId.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    if (!Array.isArray(task.depends_on) || task.depends_on.some((dep) => typeof dep !== 'string')) throw new Error(`${task.id}: depends_on must be an array of strings.`);
    if (!STATES.has(task.state)) throw new Error(`${task.id}: invalid state.`);
    if (Object.hasOwn(task, 'path') && (typeof task.path !== 'string' || !task.path || task.path.startsWith('/') || task.path.startsWith('\\\\') || /^[A-Za-z]:/u.test(task.path) || task.path.includes('\\') || task.path.split('/').includes('..'))) throw new Error(`${task.id}: invalid relative path.`);
    if (Object.hasOwn(task, 'history') && (!Array.isArray(task.history) || task.history.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || !STATES.has(entry.state)))) throw new Error(`${task.id}: invalid history.`);
    for (const field of NONEMPTY_STRING_FIELDS) {
      if (Object.hasOwn(task, field) && (typeof task[field] !== 'string' || !task[field].trim())) throw new Error(`${task.id}: invalid ${field}.`);
    }
    if (Object.hasOwn(task, 'agent_session') && (task.agent_session.length > 256 || /[\u0000-\u001f]/u.test(task.agent_session))) throw new Error(`${task.id}: invalid agent_session.`);
    if (Object.hasOwn(task, 'result_revision') && (typeof task.result_revision !== 'string' || !task.result_revision.trim())) throw new Error(`${task.id}: result_revision must identify a concrete result.`);
    if (['submitted', 'accepted'].includes(task.state) && !task.result_revision) throw new Error(`${task.id}: submitted/accepted requires result_revision.`);
    if (Object.hasOwn(task, 'attempt') && !validAttempt(task.attempt)) throw new Error(`${task.id}: invalid attempt.`);
    byId.set(task.id, task);
  }
  for (const task of data.tasks) {
    if (new Set(task.depends_on).size !== task.depends_on.length) throw new Error(`${task.id}: duplicate dependencies.`);
    for (const dep of task.depends_on) {
      if (dep === task.id || !byId.has(dep)) throw new Error(`${task.id}: unknown or self dependency ${dep}.`);
    }
  }
  const dependents = new Map([...byId.keys()].map((id) => [id, []]));
  const remaining = new Map();
  for (const [id, task] of byId) {
    remaining.set(id, task.depends_on.length);
    for (const dependency of task.depends_on) dependents.get(dependency).push(id);
  }
  const ready = [...byId.keys()].filter((id) => remaining.get(id) === 0);
  let visited = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index];
    visited += 1;
    for (const child of dependents.get(id)) {
      const left = remaining.get(child) - 1;
      remaining.set(child, left);
      if (left === 0) ready.push(child);
    }
  }
  if (visited !== byId.size) throw new Error('Dependency cycle detected in task graph.');
  return data;
}

export function loadGraph(pathname, options) {
  const graph = parseLosslessJson(readTextCompat(pathname), { rejectDuplicateKeys: true });
  return validateGraph(graph, options);
}

export function saveGraph(pathname, graph) {
  validateGraph(graph);
  atomicWrite(pathname, Buffer.from(`${legacyJson(graph, { ensureAscii: false, sortKeys: false, indent: 2 })}\n`, 'utf8'), { preserveMode: true });
  return graph;
}

export const graphSchema = Object.freeze({ load: loadGraph, validate: validateGraph, save: saveGraph });
