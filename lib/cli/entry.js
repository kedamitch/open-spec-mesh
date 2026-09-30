import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRuntime } from '../runtime/location.js';
import { renderHelp, runCommand } from './registry.js';

const HELP_FLAGS = new Set(['--help', '-h', 'help']);
const VERSION_FLAGS = new Set(['--version', '-V']);

export function entryArguments(argv, { short = false } = {}) {
  const args = [...argv];
  if (short && (args.length === 0 || (args[0].startsWith('-') && !HELP_FLAGS.has(args[0]) && !VERSION_FLAGS.has(args[0])))) {
    return ['install', '--host', 'codex', '--skip-tools', ...args];
  }
  return args;
}

export async function runEntry(argv, { entryUrl = import.meta.url, short = false, stdout = process.stdout, stderr = process.stderr } = {}) {
  const runtime = resolveRuntime(entryUrl);
  const manifest = JSON.parse(readFileSync(path.join(runtime.packageRoot, 'package.json'), 'utf8'));
  const args = entryArguments(argv, { short });
  if (args.length === 0 || HELP_FLAGS.has(args[0])) {
    const help = await renderHelp(runtime.packageRoot, manifest.version, short ? 'osm' : 'open-spec-mesh');
    const shortcut = short ? '\nNo arguments: install --host codex --skip-tools.\nInstall options may be passed directly, e.g. osm --dry-run.\n' : '';
    stdout.write(help + shortcut);
    return 0;
  }
  if (VERSION_FLAGS.has(args[0])) {
    stdout.write(`${manifest.version}\n`);
    return 0;
  }
  return runCommand(args[0], args.slice(1), { stdout, stderr, runtime });
}
