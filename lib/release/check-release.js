import path from 'node:path';
import { rootPath, metadata, readTextCompat } from '../workflow/contract.js';
import { safeInside } from '../runtime/paths.js';
import { visibleLines } from '../workflow/contract.js';
import { requirePass } from '../workflow/closure.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine, writeError } from '../cli/output.js';

const REQUIRED = ['Build', 'Tests', 'Database', 'Configuration', 'Documentation', 'Deployment', 'Rollback'];
export function requireChecklist(text) {
  const visible = visibleLines(text).map(([, line]) => line).join('\n');
  for (const heading of REQUIRED) if (!new RegExp(`^##\\s+${heading}\\s*$`, 'mu').test(visible)) throw new Error(`Release checklist missing section: ${heading}`);
  if (/^\s*-\s*\[\s\]\s+/mu.test(visible)) throw new Error('Release checklist still has unchecked items');
}
export function checkRelease(rootValue, relative) {
  const root = rootPath(rootValue);
  const directory = safeInside(root, relative);
  const fields = metadata(readTextCompat(path.join(directory, 'index.md')))[0];
  for (const changeId of String(fields.changes ?? '').split(',')) {
    const index = safeInside(root, 'docs/05-changes/C02-已完成', changeId, 'index.md');
    const change = metadata(readTextCompat(index))[0];
    if (change.status !== 'completed' || change.id !== changeId) throw new Error('Release references incomplete Change');
  }
  requirePass(readTextCompat(safeInside(root, path.relative(root, directory), fields.note)));
  requireChecklist(readTextCompat(safeInside(root, path.relative(root, directory), fields.checklist)));
  return fields.version;
}
export async function runCheckRelease(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['directory'], options: { root: { kind: 'value', default: process.cwd() } }, command: 'check-release' });
    if (args.help) { stdout.write('Usage: open-spec-mesh check-release DIRECTORY [--root PROJECT]\n'); return 0; }
    writeLine(checkRelease(args.root, args.directory), stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
