import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine, writeError } from '../cli/output.js';
import { closeChange } from './closure.js';
export async function runCloseChange(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['change_id'], options: { root: { kind: 'value', default: process.cwd() } }, command: 'close-change' });
    if (args.help) { stdout.write('Usage: open-spec-mesh close-change CHANGE_ID [--root PROJECT]\n'); return 0; }
    writeLine(await closeChange(args.root, args.change_id), stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
