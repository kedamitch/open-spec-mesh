import { parse as parseToml } from 'smol-toml';
import path from 'node:path';
import { MAX_STATE, codePointLength, encode, isJsonObject, orderedEntries, orderedKeys, packageRoot, readSafeFile, validateQuestions } from './contracts.js';

const ROLES = new Set(['main', 'worker', 'architect', 'explorer', 'librarian', 'reviewer']);

function permittedRoles(state) {
  const actor = state.current_role;
  const mode = state.execution_mode ?? 'quick';
  let allowed = new Set();
  if (actor === 'main') {
    allowed = new Set(['explorer', 'librarian']);
    if (['sdd', 'semi-auto'].includes(mode)) {
      allowed.add('architect');
      if (state.implementation_authorized === true && state.execution_strategy === 'parallel') allowed.add('worker');
      if (state.reviewer_requested === true) allowed.add('reviewer');
    }
  } else if (actor === 'architect' && ['sdd', 'semi-auto'].includes(mode)) {
    allowed = new Set(['explorer', 'librarian']);
  }
  const seen = new Set();
  return state.available_roles.filter((role) => allowed.has(role) && !seen.has(role) && seen.add(role));
}

function roleDescriptions(roles, root) {
  const output = Object.create(null);
  for (const role of roles) {
    const filename = path.join(root, 'agents', `${role}.toml`);
    try {
      const bytes = readSafeFile(filename, 64 * 1024, 'managed role description');
      const data = parseToml(bytes.toString('utf8'));
      if (data.name !== role || typeof data.description !== 'string' || !data.description.trim()) {
        throw new TypeError('managed role description unavailable');
      }
      output[role] = data.description.trim();
    } catch { throw new TypeError('managed role description unavailable'); }
  }
  return output;
}

export function prepareState(template, input, { root = packageRoot() } = {}) {
  if (!isJsonObject(input)) throw new TypeError('state must be an object');
  const orderSymbol = Object.getOwnPropertySymbols(input).find((symbol) => Array.isArray(input[symbol]));
  const inputKeys = orderedKeys(input);
  const state = Object.create(null);
  for (const key of inputKeys) state[key] = input[key];
  if (orderSymbol) Object.defineProperty(state, orderSymbol, { value: inputKeys, enumerable: false });
  if (template.id === 'execution-mode@1' && typeof state.existing_mode === 'string') {
    state.existing_mode = state.existing_mode.trim().toLowerCase();
    if (state.existing_mode === 'semi-auto') state.existing_mode = 'sdd';
  }
  if (template.id === 'delegation@1') {
    if (typeof state.current_role === 'string') state.current_role = state.current_role.trim().toLowerCase();
    if (Array.isArray(state.available_roles)) state.available_roles = state.available_roles.map((role) => typeof role === 'string' ? role.trim().toLowerCase() : role);
    const mode = state.execution_mode ?? 'quick';
    state.execution_mode = typeof mode === 'string' ? mode.trim().toLowerCase() : mode;
    if (state.execution_mode === 'semi-auto') state.execution_mode = 'sdd';
  }
  if (template.required_fields.some((field) => !Object.hasOwn(state, field))) throw new TypeError('required state fields missing');
  if (template.required_fields.includes('request') && (typeof state.request !== 'string' || !state.request.trim())) {
    throw new TypeError('request must be nonempty text');
  }
  if (template.id === 'delegation@1') {
    const { current_role: actor, available_roles: available, execution_mode: mode } = state;
    if (typeof actor !== 'string' || !ROLES.has(actor) || !Array.isArray(available)
      || available.some((role) => typeof role !== 'string' || !ROLES.has(role))) {
      throw new TypeError('delegation needs current_role and available_roles');
    }
    if (!['quick', 'semi-auto', 'sdd'].includes(mode)) throw new TypeError('delegation execution_mode must be quick or sdd (semi-auto is a compatibility alias)');
    state.available_roles = permittedRoles(state);
  }
  if (codePointLength(encode(state).toString('utf8')) > MAX_STATE) throw new TypeError('state too large; do not summarize only to call Laya');
  return state;
}

export function prepareQuestions(template, state, { root = packageRoot() } = {}) {
  if (template.id !== 'delegation@1') return template.questions;
  const actor = state.current_role;
  const executor = { ...template.questions.executor };
  const actorDescription = actor === 'main'
    ? template.questions.executor.criteria.main
    : roleDescriptions([actor], root)[actor];
  const criteria = Object.create(null);
  criteria[actor] = actorDescription;
  Object.assign(criteria, roleDescriptions(state.available_roles ?? [], root));
  criteria.uncertain = template.questions.executor.criteria.uncertain;
  executor.criteria = criteria;
  const hints = [
    '只在当前角色和 state.available_roles 中选择；候选根据角色和用户确认的执行方式筛选，建议不是阶段授权。',
    '每个候选项的 criteria 文本就是该角色对当前调用方可见的职责描述。',
    '不要推断、讨论或选择未出现在候选中的其他角色。',
    '已有证据足够且当前角色能直接完成时，优先保持当前上下文，避免无收益委派。',
  ];
  const available = new Set(state.available_roles ?? []);
  if (available.has('explorer')) hints.push('未知本地实现、调用链、状态、数据、测试或部署事实时，可优先 Explorer。');
  if (available.has('librarian')) hints.push('未知外部文档、版本、协议、SDK 或供应商当前事实时，可优先 Librarian。');
  executor.instructions = hints.join('');
  const questions = { executor };
  validateQuestions(questions);
  return questions;
}

export function guard(template, state, answers) {
  const recommendation = Object.create(null);
  for (const [name, answer] of orderedEntries(answers)) recommendation[name] = answer[answer.type];
  if (template.id === 'execution-mode@1') {
    const existing = state.existing_mode;
    if (['quick', 'semi-auto', 'sdd'].includes(existing)) recommendation.mode = existing === 'semi-auto' ? 'sdd' : existing;
  }
  if (template.id === 'delegation@1') {
    const actor = state.current_role;
    const executor = recommendation.executor;
    if (executor === 'uncertain') return null;
    const permitted = new Set([actor, ...permittedRoles(state)]);
    if (!permitted.has(executor)) return null;
    return { executor };
  }
  if (Object.values(recommendation).includes('uncertain')) return null;
  return recommendation;
}
