import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {parseToml}from '../../../lib/installation/toml.js';
const read=p=>fs.readFileSync(p,'utf8');
test('new and installed source guidance uses manual stages, macro design, serial Main and named investigation',()=>{
 for(const p of ['AGENTS.md','sdd-init/references/project-agents-template.md','sdd-init/templates/PROJECT-AGENTS.md','sdd-init/references/workflow-policy.md']){
  const t=read(p);assert.match(t,/需求 → 设计 → 执行计划 → 实现 → 交付/);assert.match(t,/单任务或串行由当前 Agent/);assert.match(t,/role_desc/);assert.match(t,/Explorer/);assert.match(t,/Librarian/);
  assert.doesNotMatch(t,/整图可执行后才冻结|一次性形成 Change|sdd prepare|sdd\.py/);
 }
});
test('macro templates have no path authorization or automatic planning identity',()=>{
 const t=read('sdd-plan/references/task-design-template.md');assert.match(t,/总体实现方向/);assert.doesNotMatch(t,/contract_digest|attempt|Path Contract|allow\/deny/);
 for(const p of ['sdd-req/SKILL.md','sdd-design/SKILL.md','sdd-plan/SKILL.md','sdd-do/SKILL.md','sdd-close/SKILL.md'])assert.doesNotMatch(read(p),/python3 |sdd\.py |sdd prepare/);
});
test('roles retain local authority, configurable actual-role names and independent reviewer request',()=>{
 const role=r=>parseToml(read(`agents/${r}.toml`)).developer_instructions;
 assert.match(role('worker'),/不可委派任何 Agent/);assert.match(role('reviewer'),/用户明确要求/);
 assert.match(role('architect'),/只可委派 Explorer \/ Librarian/);assert.match(read('agents/dispatch-contract.md'),/role_desc/);
});

test('clear natural-language publication selects the skill while material-only requests do not authorize upload', () => {
 for (const p of ['AGENTS.md','sdd-init/references/project-agents-template.md','sdd-init/templates/PROJECT-AGENTS.md','sdd-init/references/workflow-policy.md','sdd-release/SKILL.md']) {
  const text=read(p);assert.match(text,/\$sdd-release/u);assert.match(text,/自然语言/u);assert.match(text,/发布意图/u);assert.match(text,/发布 0\.0\.2/u);assert.doesNotMatch(text,/仅在用户显式使用|只有用户显式调用/u);assert.match(text,/本次目标版本/u);assert.match(text,/不上传/u);
 }
 assert.match(read('sdd-release/agents/openai.yaml'),/policy:\s*\n\s+allow_implicit_invocation:\s*true/u);
});


test('SDD naming and stage-specific skill guidance propagate to project and installed templates', () => {
 const files = [
  'AGENTS.md', 'docs/01-governance/G01-sdd-workflow.md',
  'sdd-init/references/project-agents-template.md', 'sdd-init/references/workflow-policy.md',
  'sdd-init/templates/PROJECT-AGENTS.md', 'sdd-init/templates/files/01-governance/G01-sdd-workflow.md',
 ];
 for (const file of files) {
  const text = read(file);
  assert.match(text, /### SDD 模式/u);
  assert.doesNotMatch(text, /半自动/u);
  for (const skill of ['init', 'req', 'design', 'plan', 'do', 'close', 'migrate', 'research', 'diagnose', 'release']) {
   assert.ok(text.includes('$sdd-' + skill), file + ' must guide sdd-' + skill);
  }
  assert.match(text, /当前阶段.*调用示例/u);
  assert.match(text, /自然语言授权同样有效/u);
  assert.match(text, /调用技能本身不等于确认后续阶段/u);
  assert.match(text, /已有合适文档结构则直接从当前阶段开始/u);
  assert.match(text, /未安装或当前会话不可用/u);
  assert.match(text, /用户要求排查执行问题/u);
  assert.match(text, /真实 npm 上传需要明确的发布意图和本次目标版本，自然语言同样有效/u);
 }
});

test('public workflow guides expose SDD skill invocations without reintroducing automatic approval', () => {
 for (const file of ['README.md', 'README.zh-CN.md', 'sdd-init/references/runtime-guide.md']) {
  const text = read(file);
  assert.match(text, /SDD/u);
  assert.doesNotMatch(text, /半自动|[Ss]emi-automatic/u);
  for (const skill of ['init', 'req', 'design', 'plan', 'do', 'close']) assert.ok(text.includes('$sdd-' + skill), file);
 }
 for (const skill of ['init', 'req', 'design', 'plan', 'do', 'close']) {
  const text = read('sdd-' + skill + '/SKILL.md');
  assert.match(text, /description: SDD 模式/u);
  assert.match(text, /\$sdd-/u);
 }
 assert.match(read('sdd-req/SKILL.md'), /不自动补齐后续材料/u);
 assert.match(read('sdd-do/SKILL.md'), /Quick 不强制建 Change\/Task/u);
 assert.match(read('sdd-close/SKILL.md'), /只有用户最终验收后才归档/u);
});
