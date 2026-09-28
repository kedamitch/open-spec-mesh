import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine, writeError } from '../cli/output.js';
import { deliver } from './lifecycle.js';
export async function runRecordDelivery(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['change_id', 'task_id'], options: { root: { kind: 'value', default: process.cwd() }, revision: { kind: 'value' }, 'evidence-file': { kind: 'value' }, attempt: { kind: 'value' } }, command: 'record-delivery' });
    if (args.help) { stdout.write('Usage: open-spec-mesh record-delivery CHANGE_ID TASK_ID --revision REV --attempt N --evidence-file FILE [--root PROJECT]\n'); return 0; }
    if (!args.revision || !args['evidence-file'] || !args.attempt) throw new UsageError('--revision, --attempt and --evidence-file are required');
    if (!/^[1-9][0-9]*$/u.test(args.attempt)) throw new UsageError('--attempt must be a positive integer');
    const result = await deliver(args.root, args.change_id, args.task_id, { result: args.revision, attempt: args.attempt, evidenceFile: args['evidence-file'] });
    writeLine(result.report, stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
