#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToml } from '../lib/installation/toml.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXPECTED = Object.freeze({
  architect: ['gpt-6-sol', 'xhigh', 'workspace-write'],
  worker: ['gpt-6-luna', 'max', 'workspace-write'],
  reviewer: ['gpt-6-luna', 'max', 'read-only'],
  explorer: ['gpt-6-luna', 'low', 'read-only'],
  librarian: ['gpt-6-luna', 'low', 'read-only'],
});
const LEAVES = new Set(['worker', 'reviewer', 'explorer', 'librarian']);
const ROLE_REFERENCES = ['Main', 'Architect', 'Worker', 'Reviewer', 'Explorer', 'Librarian'];

export function hasPositiveDelegation(text, names) {
  const target = [...names].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const verb = '(?:委派|调用|spawn|delegate)';
  const negative = new RegExp(`(?:不可|不得|不能|禁止|不应)[^。；\\n]{0,24}${verb}`, 'i');
  const direct = new RegExp(`${verb}[^。；\\n]{0,48}(?:${target})`, 'i');
  const reverse = new RegExp(`(?:${target})[^。；\\n]{0,48}${verb}`, 'i');
  const listed = new RegExp(`(?:可以|允许|只可|可)\\s*(?:委派|调用)[^。；\\n]{0,16}[:：]?\\s*\\n\\s*[-*]?\\s*(?:\\*\\*)?(?:${target})(?:\\*\\*)?`, 'i');
  if (listed.test(text)) return true;
  return text.split(/[。；;,，\n]+/u).some((clause) => clause.trim() && !negative.test(clause)
    && (direct.test(clause) || reverse.test(clause)));
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function validateRuntimeConfig(config) {
  const errors = [];
  if (config?.model !== 'gpt-6-luna' || config?.model_reasoning_effort !== 'max') errors.push('Main must use Luna 6 max');
  const features = config?.features;
  if (!features || typeof features !== 'object' || features.multi_agent !== true) return [...errors, 'Multi-agent feature must be enabled'];
  const v2 = features.multi_agent_v2;
  if (!v2 || typeof v2 !== 'object' || v2.enabled !== true) errors.push('Multi-Agent V2 must be enabled');
  else {
    const budget = v2.max_concurrent_threads_per_session;
    if (!Number.isSafeInteger(budget) || budget < 1) errors.push('V2 concurrency budget must be a positive integer');
    if (v2.tool_namespace !== 'agents') errors.push('V2 tool namespace must be agents');
    if (v2.hide_spawn_agent_metadata !== false) errors.push('V2 agent role metadata must be visible');
    if (v2.expose_spawn_agent_model_overrides !== false) errors.push('Spawn-time model overrides must stay disabled');
    if (v2.wait_agent_enabled !== true) errors.push('V2 wait_agent must be enabled');
  }
  const agents = config?.agents;
  if (!agents || typeof agents !== 'object' || agents.enabled !== true) return [...errors, 'Missing/enabled agents table'];
  for (const legacy of ['max_depth', 'max_threads', 'max_concurrent_threads_per_session']) {
    if (Object.hasOwn(agents, legacy)) errors.push(`Legacy V1 setting must be removed: agents.${legacy}`);
  }
  if (agents.default_subagent_model !== 'gpt-6-luna' || agents.default_subagent_reasoning_effort !== 'max') errors.push('Default child must use Luna 6 max');
  for (const role of Object.keys(EXPECTED)) {
    const entry = agents[role];
    if (!entry || typeof entry !== 'object') errors.push(`${role}: missing role table`);
    else if (entry.config_file !== `agents/${role}.toml`) errors.push(`${role}: invalid config file`);
  }
  return errors;
}

function read(root, relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }

export function validateDispatch(root) {
  const errors = [];
  try {
    const text = read(root, 'agents/dispatch-contract.md');
    for (const token of ['mode', 'goal', 'scope', 'known_facts', 'unknowns', 'constraints', 'expected_output']) {
      if (!text.includes(`\`${token}\``)) errors.push(`dispatch: missing ${token}`);
    }
    for (const phrase of ['不维护全局 Routing Graph', '自己角色说明允许的 delegate', '不要向子 Agent 注入', '全局角色拓扑', '固定 Role Prompt', '当前 Dispatch Packet']) {
      if (!text.includes(phrase)) errors.push('dispatch: local delegation contract missing');
    }
    for (const forbidden of ['## 2. SDD 状态与确定性路由', '## 3. 语义路由', '## 4. 权限', 'Quick：Main 可委派', 'Architect 只可继续委派', 'Reviewer：仅 SDD']) {
      if (text.includes(forbidden)) errors.push('dispatch: global routing topology leaked into common contract');
    }
  } catch (error) { errors.push(error.message); }
  return errors;
}

export function validateMain(root) {
  const errors = [];
  try {
    const text = read(root, 'AGENTS.md');
    if (!text.includes('## 2. 我的委派') || !text.includes('Main 只需要知道自己可以委派的角色')) errors.push('main: local delegation section missing');
    for (const role of ['Architect', 'Worker', 'Reviewer', 'Explorer', 'Librarian']) {
      if (!text.includes(`| ${role} |`)) errors.push(`main: missing own delegate ${role}`);
    }
    for (const forbidden of ['Architect 只可继续委派', 'Worker、Reviewer、Explorer、Librarian 不可继续委派']) {
      if (text.includes(forbidden)) errors.push('main: foreign delegation topology leaked');
    }
  } catch (error) { errors.push(error.message); }
  return errors;
}

export function validate(root = ROOT) {
  const errors = [];
  try {
    const config = parseToml(read(root, 'config.toml'));
    errors.push(...validateRuntimeConfig(config), ...validateDispatch(root), ...validateMain(root));
    const configAgents = config.agents ?? {};
    for (const [role, [model, effort, sandbox]] of Object.entries(EXPECTED)) {
      const data = parseToml(read(root, `agents/${role}.toml`));
      for (const [key, expected] of Object.entries({ name: role, model, model_reasoning_effort: effort, sandbox_mode: sandbox })) {
        if (data[key] !== expected) errors.push(`${role}: incorrect ${key}`);
      }
      const description = data.description;
      const prompt = data.developer_instructions;
      if (typeof description !== 'string' || !['适用：', '不适用：'].every((part) => description.includes(part))) errors.push(`${role}: description needs trigger and negative boundary`);
      if (typeof prompt !== 'string' || !prompt.trim()) { errors.push(`${role}: developer_instructions is required`); continue; }
      if (configAgents[role]?.description !== description) errors.push(`${role}: config description must mirror role TOML`);
      if (!prompt.includes('恢复同一任务')) errors.push(`${role}: resume semantics required`);
      if (!['status', 'evidence', 'artifacts', 'blockers'].every((part) => prompt.includes(part))) errors.push(`${role}: common output envelope required`);
      if (role === 'architect') {
        const required = ['只处理 mode=sdd', 'fork_turns="none"', '## 我的委派', 'Explorer', 'Librarian', 'Task Graph', 'Task Contract', '调用方不应重新拆分', 'Design 深度必须与任务复杂度匹配', '所有 Task Contract 的详细设计', '不得等 Task ready'];
        if (!required.every((part) => prompt.includes(part))) errors.push('architect: planning ownership and local delegation required');
        if (hasPositiveDelegation(prompt, ['Main', 'Worker', 'Reviewer'])) errors.push('architect: unauthorized delegation authority');
      }
      if (role === 'reviewer' && !['仅执行 mode=sdd 且用户明确要求', 'reviewer_requested=true', 'Quick'].every((part) => prompt.includes(part))) errors.push('reviewer: explicit-user SDD gate required');
      if (role === 'worker' && !['mode=quick', 'permission_denied', 'Design-backed Task Contract'].every((part) => prompt.includes(part))) errors.push('worker: Quick prohibition and frozen contract required');
      if (['explorer', 'librarian'].includes(role) && !['Quick', 'SDD'].every((part) => description.includes(part))) errors.push(`${role}: investigation mode coverage required`);
      if (LEAVES.has(role)) {
        if (!prompt.includes('不可委派任何 Agent')) errors.push(`${role}: leaf no-delegation rule required`);
        if (hasPositiveDelegation(prompt, ROLE_REFERENCES)) errors.push(`${role}: unauthorized delegation authority`);
      }
      if (Object.hasOwn(data, 'agents') || Object.hasOwn(data, 'features')) errors.push(`${role}: role-local multi-agent switches forbidden`);
    }
  } catch (error) { errors.push(error.message); }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validate();
  if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write('agents: local delegation contracts and V2 static configuration valid\n');
}
