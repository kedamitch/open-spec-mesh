import path from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rootPath, inside, metadata, mappedDocument, activeChange } from '../documents/common.js';
import { graphSchema } from '../runtime/graph-schema.js';
import { readTextCompat, sha256 } from '../runtime/text.js';
import { safeInside } from '../runtime/paths.js';
import { atomicWrite } from '../runtime/io.js';
import { planningComplete, taskContractReferences, scopedChangeContract, scopedDesignContract, validateChange, validateDesignTaskGraph } from './readiness.js';
import { validateEvidence } from './evidence.js';

export { rootPath, activeChange, metadata, readTextCompat };

export function document(root, directory, fields, key) {
  const name = fields[key];
  if (typeof name !== 'string' || !name) throw new Error(`Missing document mapping: ${key}`);
  const relative = path.posix.normalize(name);
  if (path.isAbsolute(name) || name.includes('\\') || relative === '..' || relative.startsWith('../') || relative !== name) throw new Error('Metadata document mapping is invalid');
  if (key !== 'graph' && path.posix.basename(name) !== name) throw new Error('Metadata document must be a direct child');
  return safeInside(root, path.relative(root, directory), ...name.split('/'));
}

export function planningPart(text) {
  const { stable } = splitContract(text);
  return stable;
}

export function context(rootValue, changeId, taskId = null) {
  const root = rootPath(rootValue);
  const [change, fields] = activeChange(root, changeId);
  if (!fields.graph) throw new Error('Change has no Task graph');
  const graphPath = document(root, change, fields, 'graph');
  const graph = graphSchema.load(graphPath);
  if (taskId === null || taskId === undefined) return { root, change, fields, graphPath, graph };
  const task = graph.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error('Unknown task');
  if (typeof task.path !== 'string' || !Array.isArray(task.history)) throw new Error('Task requires a relative path and history array');
  const directory = safeInside(root, path.relative(root, change), ...task.path.split('/'));
  const taskRoot = document(root, change, fields, 'tasks');
  if (path.dirname(directory) !== taskRoot) throw new Error('Task must be a direct child of its mapped task directory');
  const [tf] = metadata(readTextCompat(path.join(directory, 'index.md')));
  if (tf.id !== taskId || Object.keys(tf).sort().join(',') !== 'contract,id,report') throw new Error('Task index contract is invalid');
  document(root, directory, tf, 'contract');
  document(root, directory, tf, 'report');
  return { root, change, fields, graphPath, graph, task, directory, taskFields: tf };
}

export function saveGraph(graphPath, graph) { return graphSchema.save(graphPath, graph); }

export function git(root, ...args) {
  const result = spawnSync('git', ['-C', String(root), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Git command failed: ${args.join(' ')}`);
  return result.stdout.replace(/[\r\n]+$/u, '');
}

export function gitBuffer(root, ...args) {
  const result = spawnSync('git', ['-C', String(root), ...args], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8').trim() || `Git command failed: ${args.join(' ')}`);
  return result.stdout;
}

export function revision(root, value) {
  if (typeof value !== 'string' || !value) throw new Error('Revision is required');
  return git(root, 'rev-parse', '--verify', '--end-of-options', `${value}^{commit}`);
}

export function ancestor(root, older, newer) {
  const result = spawnSync('git', ['-C', String(root), 'merge-base', '--is-ancestor', older, newer], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result.status === 0;
}

export function event(task, state, details = {}) {
  task.history.push({ state, ...details });
  task.state = state;
}

export function contractDigest(root, change, fields, directory, taskFields) {
  const changeSource = mappedDocument(root, change, fields, 'contract');
  const changeText = readTextCompat(changeSource);
  const taskSource = document(root, directory, taskFields, 'contract');
  const taskText = readTextCompat(taskSource);
  const designSource = mappedDocument(root, change, fields, 'design');
  const designText = readTextCompat(designSource);
  let parts;
  try {
    const graph = graphSchema.load(document(root, change, fields, 'graph'));
    const task = graph.tasks.find((item) => item.id === taskFields.id);
    if (!task) throw new Error('Task missing from canonical Graph');
    const definitions = validateChange(changeText, path.relative(root, changeSource));
    validateDesignTaskGraph(designText, graph.tasks, path.relative(root, designSource), definitions);
    const refs = taskContractReferences(taskText, task, graph.tasks.map((item) => item.id), definitions, path.relative(root, taskSource));
    parts = [
      scopedChangeContract(changeText, refs.acs, path.relative(root, changeSource)),
      scopedDesignContract(designText, task.id, refs.design, path.relative(root, designSource)),
      `${taskText.trimEnd()}\n`,
    ];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    parts = [changeText, designText, taskText];
  }
  return createHash('sha256').update(parts.join('\n---SDD-CONTRACT---\n'), 'utf8').digest('hex');
}

export function validateDelivery(root, task, report, taskContract) {
  const { fields, body } = parseSpec(report);
  if (fields.status !== 'submitted') throw new Error('Worker delivery missing');
  if (fields.contract_digest !== task.contract_digest) throw new Error('Delivery is from a different contract');
  if (fields.attempt !== String(task.attempt ?? 0)) throw new Error('Stale delivery from a previous dispatch attempt');
  if (fields.baseline !== task.baseline) throw new Error('Delivery baseline does not match assigned baseline');
  const sha = revision(root, fields.revision);
  if (!ancestor(root, task.baseline, sha)) throw new Error('Delivery must descend from assigned baseline');
  validateEvidence(root, task.baseline, sha, body, taskContract);
  return sha;
}

export function frozenContractDrifts(root, changeId, graph = null) {
  const base = context(root, changeId);
  const selectedGraph = graph ?? base.graph;
  const stale = new Set();
  for (const item of selectedGraph.tasks) {
    if (!item.contract_digest) continue;
    const current = context(root, changeId, item.id);
    if (item.contract_digest !== contractDigest(root, current.change, current.fields, current.directory, current.taskFields)) stale.add(item.id);
  }
  return stale;
}

export function planningCompleteForChange(root, change, fields, directory = null, taskFields = null) {
  return planningComplete(root, change, fields, directory, taskFields);
}

export function parseSpec(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') throw new Error('Spec requires scalar frontmatter.');
  const fields = Object.create(null);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('Spec frontmatter is not closed.');
  for (const line of lines.slice(1, end)) {
    const split = line.indexOf(':');
    const key = split < 0 ? '' : line.slice(0, split).trim();
    const value = split < 0 ? '' : line.slice(split + 1).trim();
    if (!key || !value || Object.hasOwn(fields, key)) throw new Error('Spec frontmatter contains an invalid or duplicate field.');
    fields[key] = value;
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

export function shaText(text) { return sha256(Buffer.from(text, 'utf8')); }
export function writeSpec(file, fields, body) {
  const data = `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${String(value)}\n`).join('')}---\n${body}`;
  atomicWrite(file, Buffer.from(data, 'utf8'), { preserveMode: true });
}

// Kept here so all workflow consumers split Change evidence identically.
export function splitContract(text) {
  let body = text;
  let fields = {};
  if (text.startsWith('---\n')) ({ fields, body } = parseSpec(text));
  const lines = body.split(/(?<=\n)/u);
  const raw = body.split('\n');
  const visible = visibleLines(body);
  const begins = visible.filter(([, line]) => line === '<!-- SDD:EVIDENCE:BEGIN -->').map(([i]) => i);
  const ends = visible.filter(([, line]) => line === '<!-- SDD:EVIDENCE:END -->').map(([i]) => i);
  if (begins.length !== 1 || ends.length !== 1 || begins[0] >= ends[0]) throw new Error('Require exactly one ordered SDD:EVIDENCE marker pair');
  if (raw.slice(ends[0] + 1).join('\n').trim()) throw new Error('Evidence region must be the final region of the document');
  const evidence = raw.slice(begins[0] + 1, ends[0]).join('\n');
  const heads = visibleLines(evidence).filter(([, line]) => /^#{1,2}\s/u.test(line)).map(([, line]) => line);
  if (heads.join('|') !== '## 验证结果|## 最终结论') throw new Error('Evidence must contain only ## 验证结果 and ## 最终结论');
  let stable = raw.slice(0, begins[0]).join('\n').trimEnd() + '\n';
  const close = new Set(['integrated_revision', 'product', 'technology', 'operations']);
  const immutable = Object.fromEntries(Object.entries(fields).filter(([key]) => !close.has(key)).sort(([a], [b]) => a.localeCompare(b)));
  if (Object.keys(immutable).length) stable = `---\n${Object.entries(immutable).map(([k, v]) => `${k}: ${v}\n`).join('')}---\n${stable}`;
  return { stable, evidence };
}

export function visibleLines(text) {
  const result = [];
  let fence = null;
  let comment = false;
  for (const [index, line] of text.split(/(?<=\n)/u).entries()) {
    const raw = line.replace(/[\r\n]+$/u, '');
    const match = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
      continue;
    }
    if (comment) { if (raw.includes('-->')) comment = false; continue; }
    if ([ '<!-- SDD:EVIDENCE:BEGIN -->', '<!-- SDD:EVIDENCE:END -->' ].includes(raw)) result.push([index, raw]);
    else if (raw.includes('<!--')) { if (!raw.slice(raw.indexOf('<!--') + 4).includes('-->')) comment = true; }
    else if (match) fence = match[1];
    else if (!raw.startsWith('    ') && !raw.startsWith('\t')) result.push([index, raw]);
  }
  if (fence || comment) throw new Error('Unclosed Markdown code fence or HTML comment');
  return result;
}
