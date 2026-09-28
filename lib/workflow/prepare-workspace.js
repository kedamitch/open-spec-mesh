import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine, writeError } from '../cli/output.js';
import { prepareWorkspace } from './workspace.js';
export async function runPrepareWorkspace(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['change_id', 'task_id'], options: { root: { kind: 'value', default: process.cwd() }, base: { kind: 'value', default: 'HEAD' }, worktree: { kind: 'value' }, reuse: { kind: 'boolean' } }, command: 'prepare-workspace' });
    if (args.help) { stdout.write('Usage: open-spec-mesh prepare-workspace CHANGE_ID TASK_ID [--base REVISION] [--worktree PATH] [--reuse] [--root PROJECT]\n'); return 0; }
    writeLine(await prepareWorkspace(args.root, args.change_id, args.task_id, args.base, args.worktree, args.reuse), stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
