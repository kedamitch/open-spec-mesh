#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToml } from '../lib/installation/toml.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXPECTED = Object.freeze({ architect: ['gpt-6.1-sol','xhigh','workspace-write'], worker: ['gpt-6-luna','max','workspace-write'], reviewer: ['gpt-6-luna','max','read-only'], explorer: ['gpt-6-luna','low','read-only'], librarian: ['gpt-6-luna','low','read-only'] });
export function validateAgentName(role, name) {
  return Object.hasOwn(EXPECTED, role) && typeof name === 'string' && name.startsWith(`${role}_`) && /^[a-z]+_[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(name);
}
export function validateRuntimeConfig(config) {
  const errors = [];
  if(config.model !== 'gpt-6-luna' || config.model_reasoning_effort !== 'max') errors.push('Main must use Luna 6 max');
  const v2=config.features?.multi_agent_v2;
  if(config.features?.multi_agent !== true || v2?.enabled !== true || v2.tool_namespace !== 'agents') errors.push('Multi-Agent V2 must be enabled');
  if(!Number.isSafeInteger(v2?.max_concurrent_threads_per_session)||v2.max_concurrent_threads_per_session<1) errors.push('V2 concurrency budget must be positive');
  if(v2?.expose_spawn_agent_model_overrides !== false) errors.push('Spawn-time model overrides must stay disabled');
  for(const k of ['max_depth','max_threads','max_concurrent_threads_per_session'])if(Object.hasOwn(config.agents??{},k))errors.push(`Legacy V1 setting must be removed: ${k}`);
  if(config.agents?.enabled !== true) errors.push('Missing/enabled agents table');
  for(const r of Object.keys(EXPECTED)) if(config.agents?.[r]?.config_file !== `agents/${r}.toml`)errors.push(`${r}: invalid config file`);
  return errors;
}
export function validate(root=ROOT) {
  try {
    const config=parseToml(fs.readFileSync(path.join(root,'config.toml'),'utf8'));
    const errors=validateRuntimeConfig(config);
    for(const [role,expected]of Object.entries(EXPECTED)){
      const data=parseToml(fs.readFileSync(path.join(root,'agents',`${role}.toml`),'utf8'));
      if(data.name!==role) errors.push(`${role}: invalid role name`);
      if(data.model!==expected[0]||data.model_reasoning_effort!==expected[1]||data.sandbox_mode!==expected[2])errors.push(`${role}: model/effort/sandbox drift`);
      if(config.agents?.[role]?.description!==data.description)errors.push(`${role}: config description must mirror role TOML`);
      if(typeof data.developer_instructions!=='string'||!data.developer_instructions.trim())errors.push(`${role}: missing role instructions`);
      if(Object.hasOwn(data,'agents')||Object.hasOwn(data,'features'))errors.push(`${role}: role-local multi-agent switches forbidden`);
    }
    return errors;
  }catch(e){return [e.message];}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const errors=validate();if(errors.length){process.stderr.write(errors.join('\n')+'\n');process.exitCode=1;}else process.stdout.write('agents: native role configuration valid (not stage authorization)\n');
}
