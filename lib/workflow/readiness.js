import path from 'node:path';
import { metadata, mappedDocument, inside } from '../documents/common.js';
import { readTextCompat } from '../runtime/text.js';
import { graphSchema } from '../runtime/graph-schema.js';
import { visibleLines, splitContract } from './contract.js';

const AC = /(?<![A-Za-z0-9_-])AC-[0-9]+(?![A-Za-z0-9_-])/gu;
const DESIGN = /(?<![A-Za-z0-9_-])D[0-9]+(?![A-Za-z0-9_-])/gu;
const MARKER = /^(?:pending|tbd|todo|待补充|待交付|待核实)[。.!！?？:：;；\s]*$/iu;
const PREFIX = /^(?:todo|tbd|待补充|待交付|待核实)\s*[:：。]\s*.+$/iu;
const LIST = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/u;
const NONE = new Set(['none', '无', '无。', '无依赖', '无直接依赖', '无专属决策', '仅公共设计', 'shared-only', '-']);
const codeRefs = /`([^`]+)`/gu;
const acRegex = /(?<![A-Za-z0-9_-])AC-[0-9]+(?![A-Za-z0-9_-])/u;
const designRegex = /(?<![A-Za-z0-9_-])D[0-9]+(?![A-Za-z0-9_-])/u;
const taskIdRegex = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function section(text, heading, label = 'Document', level = 2, optional = false) {
  const hashes = '#'.repeat(level);
  const re = new RegExp(String.raw`^${hashes}\s+${esc(heading)}\s*$\n([\s\S]*?)(?=^${hashes}\s|(?![\s\S]))`, 'mu');
  const match = text.match(re);
  if (!match && !optional) throw new Error(`${label}: missing section: ${heading}`);
  return match?.[1] ?? null;
}
export function subsection(text, heading, label = 'Document', optional = false) {
  const re = new RegExp(String.raw`^###\s+${esc(heading)}\s*$\n([\s\S]*?)(?=^###\s|^##\s|(?![\s\S]))`, 'mu');
  const match = text.match(re);
  if (!match && !optional) throw new Error(`${label}: missing subsection: ${heading}`);
  return match?.[1] ?? null;
}
function scalar(value) { return value.trim().replace(/^[*_]+|[*_]+$/gu, '').trim(); }
function identifier(value) { return value.trim().replace(/[`*_]/gu, '').trim(); }
function isNone(value) { return NONE.has(identifier(value).toLowerCase()); }
function hasLetter(value) { return /[^\W_]/u.test(value); }

export function planningLines(text, label = 'Document') {
  let source = text;
  if (source.startsWith('---\n')) source = metadata(source)[1];
  visibleLines(source);
  source = source.replace(/<!--[\s\S]*?-->/gu, (m) => '\n'.repeat((m.match(/\n/gu) ?? []).length));
  const rows = visibleLines(source);
  const separators = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const [lineNo, line] = rows[i];
    if (line.trim().startsWith('|') && line.trim().replace(/^\||\|$/gu, '').split('|').every((cell) => /^:?-+:?$/u.test(cell.trim()))) {
      separators.add(lineNo);
      if (i) separators.add(rows[i - 1][0]);
    }
  }
  const result = [];
  for (const [lineNo, line] of rows) {
    let value = line.trim().replace(LIST, '').replace(/^(?:>\s*)+/u, '').trim();
    if (!value || separators.has(lineNo) || /^#{1,6}\s/u.test(value)) continue;
    const cells = value.startsWith('|') ? value.replace(/^\||\|$/gu, '').split('|') : [value];
    for (const cell of cells) {
      const s = scalar(cell);
      const tail = s.split(/[:：]/u).slice(1).join(':').trim();
      if (MARKER.test(s) || PREFIX.test(s) || (tail && (MARKER.test(scalar(tail)) || PREFIX.test(scalar(tail))))) throw new Error(`${label} (planning line ${lineNo + 1}): unfinished planning field: ${cell.trim()}`);
    }
    if (hasLetter(value)) result.push([lineNo, value]);
  }
  if (!result.length) throw new Error(`${label}: real planning content is required, not headings/comments/examples`);
  return result;
}

export function acDefinitions(text, label = 'Change') {
  const { stable } = splitContract(text);
  const behavior = section(stable, '行为与验收标准', label);
  const matches = [...behavior.matchAll(/^###\s+(AC-[0-9]+)(?:\s*[｜|:：-]\s*(.*))?\s*$/gmu)];
  if (!matches.length) throw new Error(`${label}: 行为与验收标准 must define at least one AC-xx subsection`);
  const definitions = new Map();
  matches.forEach((match, index) => {
    const id = match[1];
    if (Number(id.slice(3)) === 0 || definitions.has(id)) throw new Error(`${label}: zero or duplicate AC definition: ${id}`);
    const end = matches[index + 1]?.index ?? behavior.length;
    const body = behavior.slice(match.index + match[0].length, end).trim();
    planningLines(body, `${label} / ${id}`);
    definitions.set(id, `${match[0].trim()}\n${body}`);
  });
  return { stable, definitions };
}
export function validateChange(text, label = 'Change') {
  const { stable, definitions } = acDefinitions(text, label);
  planningLines(stable, label);
  return new Set(definitions.keys());
}
export function validateTask(text, definitions, label = 'Task') {
  const refs = new Set(planningLines(text, label).flatMap(([, line]) => [...line.matchAll(AC)].map((m) => m[0])));
  if (!refs.size) throw new Error(`${label}: reference at least one Change AC-xx`);
  const unknown = [...refs].filter((ref) => !definitions.has(ref));
  if (unknown.length) throw new Error(`${label}: unknown Change AC references: ${unknown.sort().join(', ')}`);
}
function mention(id, lines) { const re = new RegExp(`(?<![A-Za-z0-9_-])${esc(id)}(?![A-Za-z0-9_-])`, 'u'); return lines.some((line) => re.test(line)); }
function parseLabeled(value, pattern, label, allowNone = true) {
  if (allowNone && isNone(value)) return new Set();
  const refs = [...value.matchAll(codeRefs)].map((m) => m[1]);
  if (!refs.length) throw new Error(`${label}: use backticked IDs or 无`);
  if (new Set(refs).size !== refs.length) throw new Error(`${label}: duplicate references are not allowed`);
  const bad = refs.filter((item) => !pattern.test(item));
  if (bad.length) throw new Error(`${label}: invalid references: ${bad.sort().join(', ')}`);
  return new Set(refs);
}
function refSection(text, heading, pattern, label, allowNone = true) {
  const part = subsection(text, heading, label, true);
  if (part === null) return null;
  const lines = visibleLines(part).map(([, line]) => line.trim().replace(LIST, '').trim()).filter(Boolean);
  const plain = lines.join(' ');
  const refs = [...plain.matchAll(codeRefs)].map((m) => m[1]);
  if (refs.length) {
    if (new Set(refs).size !== refs.length) throw new Error(`${label}: duplicate references are not allowed`);
    const bad = refs.filter((item) => !pattern.test(item));
    if (bad.length) throw new Error(`${label}: invalid references: ${bad.sort().join(', ')}`);
    return new Set(refs);
  }
  if (allowNone && (plain.startsWith('无') || plain.includes('无专属决策'))) return new Set();
  throw new Error(`${label}: use backticked IDs or a clear 无 statement`);
}
function tableHeader(text) { const row = visibleLines(text).find(([, line]) => line.trim().startsWith('|')); return row ? row[1].trim().replace(/^\||\|$/gu, '').split('|').map((c) => c.trim()) : null; }
function designDecisions(text, label = 'Design') {
  const body = section(text, '关键决策', label);
  const matches = [...body.matchAll(/^###\s+(D[0-9]+)(?:\s*[｜|:：-]\s*(.*))?\s*$/gmu)];
  if (!matches.length) {
    if (planningLines(body, `${label} / 关键决策`).some(([, line]) => isNone(line))) return new Map();
    throw new Error(`${label}: 关键决策 must use Dxxx subsections or explicitly state 无`);
  }
  const decisions = new Map();
  matches.forEach((match, i) => {
    if (decisions.has(match[1])) throw new Error(`${label}: duplicate Design decision: ${match[1]}`);
    const end = matches[i + 1]?.index ?? body.length;
    const content = body.slice(match.index + match[0].length, end).trim();
    planningLines(content, `${label} / ${match[1]}`);
    decisions.set(match[1], `${match[0].trim()}\n${content}`);
  });
  return decisions;
}
export function designTaskMapping(designText, tasks, label = 'Design', definitions = null) {
  const relation = section(designText, 'Task 关系与设计落点', label);
  const lines = planningLines(relation, `${label} / Task 关系与设计落点`).map(([, line]) => line);
  planningLines(section(designText, '公共设计与不变量', label), `${label} / 公共设计与不变量`);
  if (JSON.stringify(tableHeader(relation)) !== JSON.stringify(['Task', '交付结果', '前置任务', '关联设计', '验收'])) throw new Error(`${label}: Task table must be exactly Task / 交付结果 / 前置任务 / 关联设计 / 验收`);
  const ids = tasks.map((task) => typeof task === 'string' ? task : task.id);
  const decisions = designDecisions(designText, label);
  const rows = new Map();
  for (const line of lines.filter((value) => value.startsWith('|'))) {
    const cells = line.trim().replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
    if (cells.length !== 5) throw new Error(`${label}: Task relationship rows require five columns`);
    const taskRefs = parseLabeled(cells[0], taskIdRegex, `${label}: Task`);
    if (taskRefs.size !== 1) throw new Error(`${label}: each Task row must identify exactly one Task ID`);
    const id = [...taskRefs][0];
    if (!ids.includes(id)) throw new Error(`${label}: Task mapping contains unknown Task ID: ${id}`);
    if (rows.has(id)) throw new Error(`${label}: duplicate Task relationship row: ${id}`);
    const deps = parseLabeled(cells[2], taskIdRegex, `${label}: ${id} 前置任务`);
    const design = parseLabeled(cells[3], /^D[0-9]+$/u, `${label}: ${id} 关联设计`);
    const acs = parseLabeled(cells[4], /^AC-[0-9]+$/u, `${label}: ${id} 验收`, false);
    for (const dep of deps) if (!ids.includes(dep)) throw new Error(`${label}: ${id} references unknown dependencies: ${dep}`);
    for (const ref of design) if (!decisions.has(ref)) throw new Error(`${label}: ${id} references unknown Design decisions: ${ref}`);
    if (definitions) for (const ref of acs) if (!definitions.has(ref)) throw new Error(`${label}: ${id} references unknown Change ACs: ${ref}`);
    rows.set(id, { line, deps, design, acs });
  }
  const missing = ids.filter((id) => !rows.has(id));
  if (missing.length) throw new Error(`${label}: Task mapping must cover all graph Task IDs: ${missing.sort().join(', ')}`);
  for (const task of tasks) if (typeof task !== 'string') {
    const actual = rows.get(task.id).deps;
    if (actual.size !== task.depends_on.length || task.depends_on.some((item) => !actual.has(item))) throw new Error(`${label}: ${task.id} Design depends_on mismatch; graph=${task.depends_on.sort().join(',')} design=${[...actual].sort().join(',')}`);
  }
  return rows;
}
function requireMermaid(text, label, kinds) {
  const match = text.match(/```mermaid\s*\n([\s\S]*?)\n```/u);
  if (!match) throw new Error(`${label}: at least one Mermaid diagram is required`);
  if (!kinds.some((kind) => new RegExp(`^\\s*${kind}\\b`, 'mu').test(match[1]))) throw new Error(`${label}: Mermaid must contain one of: ${kinds.join(', ')}`);
}
export function validateFullDesignStructure(text, label = 'Design') {
  if (!text.trimStart().startsWith('# 公共设计')) return;
  for (const heading of ['Current 基线与变更范围', '总体方案与主流程', '产品变更', '接口变更', '领域模型与状态变更', '数据与表结构变更', '应用与组件变更', '关键决策', '公共设计与不变量', 'Task 关系与设计落点', '实现自由度与停止条件', '风险与未决问题']) planningLines(section(text, heading, label), `${label} / ${heading}`);
  requireMermaid(section(text, '总体方案与主流程', label), `${label} / 总体方案与主流程`, ['sequenceDiagram', 'flowchart']);
}
export function validateFullTaskDesign(text, label = 'Task') {
  if (!/^#\s+Task\s+`[^\n]+`：详细设计\s*$/mu.test(text)) return;
  for (const heading of ['范围与代码落点', 'Task 实现流程', '详细设计', '依赖与验收', '实现自由度', '交付要求']) {
    const body = section(text, heading, label);
    if (heading !== 'Task 实现流程') planningLines(body, `${label} / ${heading}`);
  }
  const scope = section(text, '范围与代码落点', label);
  if (!subsection(scope, '代码结构 / 模块落点', label, true)) throw new Error(`${label}: missing subsection: 代码结构 / 模块落点`);
  const detail = section(text, '详细设计', label);
  for (const heading of ['核心逻辑', 'Components', '接口变化', '领域模型 / 状态变化', '数据与表结构变化', '失败与兼容', 'Tests']) if (!subsection(detail, heading, label, true)) throw new Error(`${label}: missing subsection: ${heading}`);
  if (!subsection(section(text, '交付要求', label), 'Expected Output', label, true)) throw new Error(`${label}: missing subsection: Expected Output`);
  requireMermaid(section(text, 'Task 实现流程', label), `${label} / Task 实现流程`, ['flowchart', 'sequenceDiagram']);
}
export function validateDesignTaskGraph(designText, tasks, label = 'Design', definitions = null) {
  validateFullDesignStructure(designText, label);
  return designTaskMapping(designText, tasks, label, definitions);
}
export function taskContractReferences(text, task, taskIds, definitions, label = 'Task') {
  const deps = refSection(section(text, '依赖与验收', label), '前置任务', taskIdRegex, `${label} / 前置任务`);
  const design = refSection(section(text, '依赖与验收', label), '关联设计', /^D[0-9]+$/u, `${label} / 关联设计`);
  const acs = refSection(section(text, '依赖与验收', label), '验收标准', /^AC-[0-9]+$/u, `${label} / 验收标准`, false);
  if (deps === null || design === null || acs === null) throw new Error(`${label}: Task Contract requires 前置任务 / 关联设计 / 验收标准 subsections`);
  for (const dep of deps) if (!taskIds.includes(dep)) throw new Error(`${label}: unknown Task dependencies: ${dep}`);
  for (const ac of acs) if (!definitions.has(ac)) throw new Error(`${label}: unknown Change AC references: ${ac}`);
  if (deps.size !== task.depends_on.length || task.depends_on.some((dep) => !deps.has(dep))) throw new Error(`${label}: Task Contract depends_on mismatch; graph=${task.depends_on.join(',')} contract=${[...deps].join(',')}`);
  const allLines = planningLines(text, label).map(([, line]) => line);
  const allAcs = new Set(allLines.flatMap((line) => [...line.matchAll(AC)].map((m) => m[0])));
  const allDesign = new Set(allLines.flatMap((line) => [...line.matchAll(DESIGN)].map((m) => m[0])));
  if (allAcs.size !== acs.size || [...acs].some((x) => !allAcs.has(x))) throw new Error(`${label}: all AC references must be declared in 验收标准; declared=${[...acs].sort()} used=${[...allAcs].sort()}`);
  if (allDesign.size !== design.size || [...design].some((x) => !allDesign.has(x))) throw new Error(`${label}: all Dxxx references must be declared in 关联设计; declared=${[...design].sort()} used=${[...allDesign].sort()}`);
  return { deps, acs, design };
}
export function validateDesignBackedTask(text, designName, task, designText, definitions, taskIds, label, designMapping) {
  validateFullTaskDesign(text, label);
  if (!text.includes(designName)) throw new Error(`${label}: SDD Task must reference Design ${designName}`);
  if (!mention(task.id, [text])) throw new Error(`${label}: SDD Task must identify its Task ID ${task.id}`);
  planningLines(section(text, '详细设计', label), `${label} / 详细设计`);
  planningLines(section(text, '实现自由度', label), `${label} / 实现自由度`);
  const relation = section(designText, 'Task 关系与设计落点', 'Design');
  const lines = planningLines(relation, 'Design / Task 关系与设计落点').map(([, line]) => line);
  if (!mention(task.id, lines)) throw new Error(`${label}: Design Task mapping must reference Task ID ${task.id}`);
  const refs = taskContractReferences(text, task, taskIds, definitions, label);
  const decisions = designDecisions(designText, 'Design');
  for (const item of refs.design) if (!decisions.has(item)) throw new Error(`${label}: unknown Design decisions: ${item}`);
  if (!designMapping) throw new Error(`${label}: canonical Design Task mapping is required`);
  const mapped = designMapping.get(task.id);
  for (const key of ['deps', 'acs', 'design']) {
    if (mapped[key].size !== refs[key].size || [...mapped[key]].some((x) => !refs[key].has(x))) throw new Error(`${label}: Task Contract ${key} differ from Design Task relationship`);
  }
  return refs;
}
function withoutSection(text, heading) {
  const re = new RegExp(String.raw`^##\s+${esc(heading)}\s*$\n[\s\S]*?(?=^##\s|(?![\s\S]))`, 'mu');
  return `${text.replace(re, '').trimEnd()}\n`;
}
export function scopedChangeContract(text, acRefs, label = 'Change') {
  const { stable, definitions } = acDefinitions(text, label);
  if (!section(stable, '行为与验收标准', label, 2, true)) return stable;
  for (const id of acRefs) if (!definitions.has(id)) throw new Error(`${label}: missing scoped AC definitions: ${id}`);
  return `${withoutSection(stable, '行为与验收标准')}\n---TASK-AC---\n${[...acRefs].sort().map((id) => definitions.get(id)).join('\n')}\n`;
}
export function scopedDesignContract(designText, taskId, designRefs, label = 'Design') {
  if (!section(designText, 'Task 关系与设计落点', label, 2, true)) return `${designText.trimEnd()}\n`;
  const shared = section(designText, '公共设计与不变量', label).trimEnd();
  const freedom = section(designText, '实现自由度与停止条件', label, 2, true);
  const decisions = designDecisions(designText, label);
  for (const id of designRefs) if (!decisions.has(id)) throw new Error(`${label}: missing scoped Design decisions: ${id}`);
  const relation = section(designText, 'Task 关系与设计落点', label);
  let row = null;
  for (const [, line] of planningLines(relation, `${label} / Task 关系与设计落点`)) {
    if (!line.startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/gu, '').split('|').map((c) => c.trim());
    const refs = [...cells[0].matchAll(codeRefs)].map((m) => m[1]);
    if (identifier(cells[0]) === taskId || refs.includes(taskId)) { row = line; break; }
  }
  if (!row) throw new Error(`${label}: missing Task relationship row for ${taskId}`);
  const selected = [...designRefs].sort().map((id) => decisions.get(id)).join('\n');
  return `## 公共设计与不变量\n${shared}\n\n## 当前 Task 关键决策\n${selected || 'none'}\n\n## 当前 Task 关系\n${row}${freedom ? `\n\n## 实现自由度与停止条件\n${freedom.trimEnd()}` : ''}\n`;
}

export function planningComplete(root, change, fields, directory = null, taskFields = null) {
  const source = mappedDocument(root, change, fields, 'contract');
  const definitions = validateChange(readTextCompat(source), pathLabel(root, source));
  const designSource = mappedDocument(root, change, fields, 'design');
  const designText = readTextCompat(designSource);
  try { planningLines(designText, pathLabel(root, designSource)); } catch (error) { throw new Error(`Unfinished Design contract: ${error.message}`, { cause: error }); }
  const graphPath = inside(root, path.relative(root, change), ...fields.graph.split('/'));
  const graph = graphSchema.load(graphPath);
  const designMapping = validateDesignTaskGraph(designText, graph.tasks, pathLabel(root, designSource), definitions);
  const taskIds = graph.tasks.map((item) => item.id);
  for (const task of graph.tasks) {
    const taskDir = inside(root, path.relative(root, change), ...task.path.split('/'));
    const taskFields = metadata(readTextCompat(path.join(taskDir, 'index.md')))[0];
    const taskSource = inside(root, path.relative(root, taskDir), taskFields.contract);
    const text = readTextCompat(taskSource);
    validateTask(text, definitions, pathLabel(root, taskSource));
    validateDesignBackedTask(text, path.basename(designSource), task, designText, definitions, taskIds, pathLabel(root, taskSource), designMapping);
  }
  return definitions;
}
function pathLabel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }
