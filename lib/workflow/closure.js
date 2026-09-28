import path from 'node:path';
import { existsSync, renameSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { activeChange, context, contractDigest, document, revision, ancestor, git, readTextCompat, writeSpec } from './contract.js';
import { planningComplete } from './readiness.js';
import { visibleLines, splitContract, metadata } from './contract.js';
import { requireEvidenceBody } from './evidence.js';
import { validateReceipt } from './receipt.js';
import { withProjectLock } from '../runtime/locks.js';
import { atomicWrite } from '../runtime/io.js';
import { refresh } from '../documents/numbering.js';
import { sha256 } from '../runtime/text.js';
import { safeInside } from '../runtime/paths.js';

export function requirePass(text) {
  const visible = visibleLines(text).map(([, line]) => line);
  const heads = [];
  visible.forEach((line, index) => { if (['## 最终结论', '## Final Decision'].includes(line)) heads.push(index); });
  if (heads.length !== 1) throw new Error('Exactly one final-decision heading required');
  const content = [];
  for (const line of visible.slice(heads[0] + 1)) {
    if (/^#{1,2}\s/u.test(line)) break;
    if (line.startsWith('<!--')) continue;
    if (line.trim()) content.push(line.trim());
  }
  if (content.length !== 1 || content[0] !== 'pass') throw new Error('Final decision must contain only pass');
}
function changedNames(root, ...args) { return new Set(git(root, ...args).split('\0').filter(Boolean)); }
export function requireNoPostValidationDrift(root, change, integratedRevision) {
  const head = revision(root, 'HEAD');
  if (!ancestor(root, integratedRevision, head)) throw new Error('Current HEAD must descend from the validated integrated revision');
  const committed = head === integratedRevision ? new Set() : changedNames(root, 'diff', '--name-only', '-z', integratedRevision, head);
  const dirty = new Set([...changedNames(root, 'diff', '--name-only', '-z', 'HEAD'), ...changedNames(root, 'ls-files', '--others', '--exclude-standard', '-z')]);
  const prefix = `${path.relative(root, change).split(path.sep).join('/').replace(/\/$/u, '')}/`;
  const unexpected = [...new Set([...committed, ...dirty])].filter((file) => !file.startsWith(prefix)).sort();
  if (unexpected.length) throw new Error(`Unvalidated project changes exist after integration validation: ${unexpected.join(', ')}`);
}
export function checkChange(root, changeId) {
  const [change, fields] = activeChange(root, changeId);
  const changeText = readTextCompat(document(root, change, fields, 'contract'));
  const { evidence } = splitContract(changeText);
  requirePass(evidence);
  const evidenceLines = evidence.split(/(?<=\n)/u);
  const visible = visibleLines(evidence);
  const verificationHeaders = visible.filter(([, line]) => ['## 验证结果', '## Verification'].includes(line));
  if (verificationHeaders.length !== 1) throw new Error('Exactly one verification heading required');
  const start = verificationHeaders[0][0];
  const end = visible.find(([index, line]) => index > start && /^#{1,2}\s/u.test(line))?.[0] ?? evidenceLines.length;
  try { requireEvidenceBody(evidenceLines.slice(start + 1, end).join(''), 'verification'); }
  catch (error) { throw new Error('Actual verification evidence required', { cause: error }); }
  planningComplete(root, change, fields);
  const fieldsOnContract = metadata(changeText)[0];
  const integrated = revision(root, fieldsOnContract.integrated_revision);
  validateReceipt(root, changeId, integrated);
  requireNoPostValidationDrift(root, change, integrated);
  for (const key of ['product', 'technology', 'operations']) {
    const value = String(fieldsOnContract[key] ?? '').trim();
    if (!value || ['pending', 'not reviewed', '待补充', '待核实'].includes(value.toLocaleLowerCase('en-US'))) throw new Error(`Current Truth assessment required: ${key}`);
  }
  if (fields.graph) {
    const { graph } = context(root, changeId);
    for (const task of graph.tasks) {
      if (task.state !== 'accepted' || !ancestor(root, task.result_revision, integrated)) throw new Error('All accepted results must be included in integrated revision');
      const c = context(root, changeId, task.id);
      planningComplete(root, c.change, c.fields, c.directory, c.taskFields);
      if (task.contract_digest !== contractDigest(root, c.change, c.fields, c.directory, c.taskFields)) throw new Error('Accepted frozen Contract changed');
      const report = readTextCompat(document(root, c.directory, c.taskFields, 'report'));
      if (task.report_digest !== sha256(Buffer.from(report, 'utf8'))) throw new Error('Accepted report changed');
    }
  }
  return integrated;
}

function snapshotFile(file) {
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Expected a regular index file: ${file}`);
    return { bytes: readFileSync(file), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
function restoreFile(file, snapshot) {
  if (snapshot === null) {
    try { unlinkSync(file); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  } else atomicWrite(file, snapshot.bytes, { mode: snapshot.mode });
}

export async function closeChange(root, changeId) {
  return withProjectLock(root, () => {
    checkChange(root, changeId);
    const [change, fields, body] = activeChange(root, changeId);
    const activeParent = path.dirname(change);
    const completedParent = safeInside(root, 'docs/05-changes/C02-已完成');
    const destination = safeInside(root, 'docs/05-changes/C02-已完成', changeId);
    if (existsSync(destination)) throw new Error(`Completed Change already exists: ${changeId}`);
    const completedParentStat = lstatSync(completedParent);
    if (completedParentStat.isSymbolicLink() || !completedParentStat.isDirectory()) throw new Error('Completed Changes directory must be a real directory');

    const snapshots = new Map([
      [path.join(change, 'index.md'), snapshotFile(path.join(change, 'index.md'))],
      [path.join(activeParent, 'index.md'), snapshotFile(path.join(activeParent, 'index.md'))],
      [path.join(completedParent, 'index.md'), snapshotFile(path.join(completedParent, 'index.md'))],
    ]);
    renameSync(change, destination);
    try {
      fields.status = 'completed';
      const now = new Date();
      fields.updated = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      writeSpec(path.join(destination, 'index.md'), fields, body);
      refresh(activeParent);
      refresh(completedParent);
      return destination;
    } catch (error) {
      const rollbackErrors = [];
      try { renameSync(destination, change); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      for (const [file, snapshot] of snapshots) {
        try { restoreFile(file, snapshot); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `Could not fully roll back Change closure; preserve ${existsSync(destination) ? destination : change} for recovery`);
      throw error;
    }
  });
}
