import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine, writeError } from '../cli/output.js';
import { importDelivery } from './lifecycle.js';
export async function runImportDelivery(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['change_id', 'task_id'], options: { root: { kind: 'value', default: process.cwd() }, 'from-workspace': { kind: 'value' } }, command: 'import-delivery' });
    if (args.help) { stdout.write('Usage: open-spec-mesh import-delivery CHANGE_ID TASK_ID --from-workspace PATH [--root PROJECT]\n'); return 0; }
    if (!args['from-workspace']) throw new UsageError('--from-workspace is required');
    writeLine(await importDelivery(args.root, args.change_id, args.task_id, args['from-workspace']), stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
