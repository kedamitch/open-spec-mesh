import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { visibleLines, parseSpec } from './contract.js';
import { validateChangedPaths } from './path-contract.js';

export const DELIVERY_SECTIONS = ['文件改动', '验证结果', '自审结论', '剩余问题', '快照影响'];
const CONCLUSIONS = new Set(['通过', '部分通过', '未通过']);
const AC_RESULTS = new Set(['通过', '失败', '未执行']);
const SNAPSHOT_SCOPES = new Set(['无', 'product', 'technology', 'operations', 'multiple']);
const NONE = new Set(['无', 'none', '-']);
const AC = /(?<![A-Za-z0-9_-])AC-[0-9]+(?![A-Za-z0-9_-])/gu;

export function changedFiles(root, baseline, revision) {
  const result = spawnSync('git', ['-C', String(root), 'diff', '--name-status', '--no-renames', '-z', baseline, revision, '--'], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Cannot inspect delivery Git diff');
  const fields = result.stdout.toString('utf8').split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 2) throw new Error('Unexpected Git name-status response');
  const files = new Map();
  for (let index = 0; index < fields.length; index += 2) files.set(fields[index + 1], fields[index]);
  return files;
}

export function requireEvidenceBody(text, label = 'evidence') {
  const body = text.replace(/<!--[\s\S]*?-->/gu, '').trim();
  if (!body || ['pending', 'tbd', 'todo'].includes(body.toLocaleLowerCase('en-US')) || body.includes('待补充') || body.includes('待交付')) throw new Error(`Incomplete evidence: ${label}`);
  return body;
}
function clean(value) { return value.trim().replace(/^[*_]+|[*_]+$/gu, '').trim().replace(/[。.]$/u, ''); }
function none(value) { return NONE.has(clean(value).toLocaleLowerCase('en-US')); }
function sections(evidence) {
  const lines = evidence.split(/(?<=\n)/u);
  const heads = visibleLines(evidence).filter(([, line]) => line.startsWith('## ')).map(([i, line]) => [i, line.slice(3)]);
  if (heads.map(([, name]) => name).join('|') !== DELIVERY_SECTIONS.join('|')) throw new Error(`Evidence must have exactly these sections: ${DELIVERY_SECTIONS.join(', ')}`);
  const bodies = Object.create(null);
  heads.forEach(([start, title], index) => {
    const end = heads[index + 1]?.[0] ?? lines.length;
    const body = lines.slice(start + 1, end).join('').trim();
    requireEvidenceBody(body, title);
    bodies[title] = body;
  });
  return bodies;
}
function field(text, name) {
  const found = [];
  const regex = new RegExp(`^\\*\\*${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\*\\*\\s*[:：]\\s*(.+)$`, 'u');
  for (const [, line] of visibleLines(text)) {
    const value = line.trim().replace(/^(?:>\s*)+/u, '').replace(/^[-*+]\s+/u, '');
    const match = value.match(regex);
    if (match) found.push(match[1].trim());
  }
  if (found.length !== 1) throw new Error(`Delivery requires exactly one structured field: ${name}`);
  return requireEvidenceBody(found[0], name);
}
function tableRows(text, expected) {
  const rows = [];
  let found = false;
  for (const [, line] of visibleLines(text)) {
    const value = line.trim();
    if (!value.startsWith('|')) continue;
    const cells = value.replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
    if (JSON.stringify(cells) === JSON.stringify(expected)) {
      if (found) throw new Error('Duplicate delivery table header');
      found = true;
      continue;
    }
    if (cells.length && cells.every((cell) => /^:?-+:?$/u.test(cell))) continue;
    if (cells.length !== expected.length) throw new Error('Delivery table has an unexpected column count');
    rows.push(cells);
  }
  if (!found) throw new Error(`Delivery table header is required: ${expected.join(' / ')}`);
  return rows;
}
export function taskAcRefs(taskContract) {
  const match = taskContract.match(/^###\s+验收标准\s*\n([\s\S]*?)(?=^###\s|^##\s|(?![\s\S]))/mu);
  if (!match) throw new Error('Task Contract requires 验收标准 for Delivery generation');
  const refs = [];
  for (const [, line] of visibleLines(match[1])) for (const hit of line.matchAll(AC)) if (!refs.includes(hit[0])) refs.push(hit[0]);
  if (!refs.length) throw new Error('Task Contract 验收标准 must reference at least one AC');
  return refs;
}
export function structuredDelivery(evidence, taskContract = null) {
  const body = sections(evidence);
  const result = {
    delivery_result: field(body['文件改动'], '交付结果'),
    conclusion: clean(field(body['验证结果'], '结论')),
    fixed_issues: field(body['自审结论'], '已修复问题'),
    contract_deviation: field(body['自审结论'], '契约偏差'),
    unverified: field(body['剩余问题'], '未验证项'),
    remaining_risk: field(body['剩余问题'], '剩余风险'),
    snapshot_scope: clean(field(body['快照影响'], '范围')),
    snapshot_note: field(body['快照影响'], '说明'),
  };
  if (!CONCLUSIONS.has(result.conclusion)) throw new Error(`Delivery 结论 must be one of: ${[...CONCLUSIONS].sort().join(', ')}`);
  if (!SNAPSHOT_SCOPES.has(result.snapshot_scope)) throw new Error(`Delivery 快照范围 must be one of: ${[...SNAPSHOT_SCOPES].sort().join(', ')}`);
  const rows = tableRows(body['验证结果'], ['AC / 场景', '检查', '结果', '证据']);
  if (!rows.length) throw new Error('Delivery validation table requires at least one result row');
  const acResults = new Map();
  for (const cells of rows) {
    requireEvidenceBody(cells[1], 'validation check');
    requireEvidenceBody(cells[3], 'validation evidence');
    if (!AC_RESULTS.has(clean(cells[2]))) throw new Error(`Delivery AC result must be one of: ${[...AC_RESULTS].sort().join(', ')}`);
    const refs = [...cells[0].matchAll(AC)];
    if (refs.length > 1) throw new Error('Each Delivery validation row may reference at most one AC');
    if (refs.length) {
      const id = refs[0][0];
      if (acResults.has(id)) throw new Error(`Duplicate Delivery AC row: ${id}`);
      acResults.set(id, clean(cells[2]));
    }
  }
  if (taskContract) {
    const expected = taskAcRefs(taskContract);
    const missing = expected.filter((id) => !acResults.has(id));
    const unknown = [...acResults.keys()].filter((id) => !expected.includes(id)).sort();
    if (missing.length || unknown.length) throw new Error(`Delivery AC rows must match Task Contract; missing=${missing}; unknown=${unknown}`);
    result.expected_acs = expected;
  }
  result.ac_results = Object.fromEntries(acResults);
  const blockers = [...acResults].filter(([, outcome]) => outcome !== '通过').map(([id, outcome]) => `${id}=${outcome}`);
  if (!none(result.contract_deviation)) blockers.push('契约偏差');
  if (!none(result.unverified)) blockers.push('未验证项');
  if (result.conclusion === '通过' && blockers.length) throw new Error(`Delivery cannot claim 通过 while blockers remain: ${blockers.join(', ')}`);
  return result;
}
export function acceptanceBlockers(evidence, taskContract) {
  const summary = structuredDelivery(evidence, taskContract);
  const blockers = [];
  if (summary.conclusion !== '通过') blockers.push(`验证结论=${summary.conclusion}`);
  for (const [id, outcome] of Object.entries(summary.ac_results)) if (outcome !== '通过') blockers.push(`${id}=${outcome}`);
  if (!none(summary.contract_deviation)) blockers.push('契约偏差');
  if (!none(summary.unverified)) blockers.push('未验证项');
  return blockers;
}
export function validateEvidence(root, baseline, revision, evidence, taskContract = null, label = 'Task Path Contract') {
  const body = sections(evidence);
  structuredDelivery(evidence, taskContract);
  const notes = new Map();
  for (const cells of tableRows(body['文件改动'], ['文件', '操作', '行为影响'])) {
    const match = cells[0].match(/^`([^`]+)`$/u);
    if (!match) throw new Error('Delivery file rows require a backticked path');
    const filename = match[1];
    if (notes.has(filename) || !cells[1] || !cells[2] || ['-', '无'].includes(cells[2])) throw new Error('Each file requires a unique path, operation and concrete behavior impact');
    requireEvidenceBody(cells[2], `file note: ${filename}`);
    notes.set(filename, cells[1]);
  }
  const actual = changedFiles(root, baseline, revision);
  if (taskContract) validateChangedPaths(taskContract, actual.keys(), label);
  const actualNames = new Set(actual.keys());
  const missing = [...actualNames].filter((item) => !notes.has(item)).sort();
  const extra = [...notes.keys()].filter((item) => !actualNames.has(item)).sort();
  if (missing.length || extra.length) throw new Error(`File notes must match Git diff; missing=${missing}; extra=${extra}`);
  const ops = { A: new Set(['新增', 'A']), M: new Set(['修改', 'M']), D: new Set(['删除', 'D']), T: new Set(['类型变化', 'T']) };
  for (const [filename, operation] of actual) {
    if (/[|`\n\r]/u.test(filename)) throw new Error('Filename cannot be safely represented in this delivery table');
    if (!ops[operation]?.has(notes.get(filename))) throw new Error(`Incorrect Git operation for ${filename}`);
  }
  return actual;
}
