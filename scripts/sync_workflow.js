#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'sdd-init/references/workflow-policy.md';
export const COPIES = Object.freeze([
  'sdd-init/references/project-agents-template.md',
  'sdd-init/templates/PROJECT-AGENTS.md',
  'sdd-init/templates/files/01-governance/G01-sdd-workflow.md',
  'docs/01-governance/G01-sdd-workflow.md',
]);
export const START = '<!-- open-spec-mesh: COMMON START -->';
export const END = '<!-- open-spec-mesh: COMMON END -->';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Maintain necessary copies without touching project-specific AGENTS content. */
export function syncWorkflow(root = ROOT, { write = false } = {}) {
  const source = fs.readFileSync(path.join(root, SOURCE), 'utf8').trimEnd() + '\n';
  if (!source.trim()) throw new Error('Empty shared workflow policy');
  const rootFile = path.join(root, 'AGENTS.md');
  const existing = fs.readFileSync(rootFile, 'utf8');
  const first = existing.indexOf(START), last = existing.indexOf(END);
  if (first < 0 || last <= first || existing.indexOf(START, first + START.length) >= 0 || existing.indexOf(END, last + END.length) >= 0) {
    throw new Error('AGENTS common markers missing or ambiguous; refusing to replace user content');
  }
  const expectedRoot = existing.slice(0, first + START.length) + '\n' + source + existing.slice(last);
  const expected = new Map([...COPIES.map((copy) => [copy, source]), ['AGENTS.md', expectedRoot]]);
  const drift = [];
  for (const [relative, text] of expected) {
    const file = path.join(root, relative);
    if (fs.readFileSync(file, 'utf8') === text) continue;
    drift.push(relative);
    if (write) fs.writeFileSync(file, text);
  }
  return drift;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--check', '--write'].includes(args[0])) throw new Error('Usage: node scripts/sync_workflow.js --check|--write');
    const write = args[0] === '--write';
    const drift = syncWorkflow(ROOT, { write });
    if (drift.length && !write) { process.stderr.write(`Shared workflow copies drifted: ${drift.join(', ')}\n`); process.exitCode = 1; }
    else process.stdout.write(`Shared workflow ${write ? 'synchronized' : 'consistent'} (${drift.length} changed); project rules preserved.\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
