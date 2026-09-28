import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine, writeError } from '../cli/output.js';
import { accept } from './lifecycle.js';
export async function runRecordAcceptance(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['change_id', 'task_id', 'decision'], options: { root: { kind: 'value', default: process.cwd() }, reason: { kind: 'value' }, 'workers-stopped': { kind: 'boolean' } }, command: 'record-acceptance' });
    if (args.help) { stdout.write('Usage: open-spec-mesh record-acceptance CHANGE_ID TASK_ID accept|rework --reason TEXT [--workers-stopped] [--root PROJECT]\n'); return 0; }
    if (!args.reason) throw new UsageError('--reason is required');
    writeLine(await accept(args.root, args.change_id, args.task_id, args.decision, args.reason, args['workers-stopped']), stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
