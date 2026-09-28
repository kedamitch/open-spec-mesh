import { parseArgs, UsageError } from '../cli/args.js';
import { writeJson, writeError } from '../cli/output.js';
import { runValidation as validate } from './receipt.js';
export async function runValidation(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['change_id'], options: { root: { kind: 'value', default: process.cwd() }, revision: { kind: 'value', default: 'HEAD' } }, command: 'run-validation' });
    if (args.help) { stdout.write('Usage: open-spec-mesh run-validation CHANGE_ID [--revision REVISION] [--root PROJECT]\n'); return 0; }
    writeJson(await validate(args.root, args.change_id, args.revision), stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
