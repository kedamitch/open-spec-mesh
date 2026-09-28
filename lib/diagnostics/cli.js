import os from 'node:os';
import path from 'node:path';
import { projectRoot, runBundle } from './bundle.js';

const ROLES = new Set(['architect', 'worker', 'reviewer', 'explorer', 'librarian']);
const expand = (value) => String(value).startsWith(`~${path.sep}`) ? path.join(os.homedir(), String(value).slice(2)) : String(value) === '~' ? os.homedir() : String(value);

export function diagnoseHelp() {
  return 'Usage: open-spec-mesh diagnose [--root DIR] [--days N] [--limit N] [--output FILE.zip] [--sessions-dir DIR] [--rules-root DIR] [--expected-mode unknown|quick|sdd] [--expect-role ROLE]\n';
}

export async function runDiagnose(argv = [], streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  const options = { root: process.cwd(), days: 7, limit: 20, expectedMode: 'unknown', expectedRoles: [] };
  try {
    for (let index = 0; index < argv.length; index += 1) {
      const flag = argv[index];
      if (flag === '--help' || flag === '-h') { stdout.write(diagnoseHelp()); return 0; }
      if (!['--root', '--days', '--limit', '--output', '--sessions-dir', '--rules-root', '--expected-mode', '--expect-role'].includes(flag)) throw new TypeError(`Unknown option: ${flag}`);
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new TypeError(`${flag} requires a value`);
      if (flag === '--root') options.root = expand(value);
      else if (flag === '--days') options.days = Number(value);
      else if (flag === '--limit') options.limit = Number(value);
      else if (flag === '--output') options.output = expand(value);
      else if (flag === '--sessions-dir') options.sessionsDirectory = path.resolve(expand(value));
      else if (flag === '--rules-root') options.rulesRoot = path.resolve(expand(value));
      else if (flag === '--expected-mode') options.expectedMode = value;
      else if (flag === '--expect-role') options.expectedRoles.push(value);
    }
    if (!Number.isInteger(options.days) || !Number.isInteger(options.limit)) throw new TypeError('days and limit must be integers');
    if (!['unknown', 'quick', 'sdd'].includes(options.expectedMode)) throw new TypeError('Invalid --expected-mode');
    if (options.expectedRoles.some((role) => !ROLES.has(role))) throw new TypeError('Invalid --expect-role');
    const project = await projectRoot(options.root);
    const hostHome = path.resolve(expand(process.env.CODEX_HOME || path.join(os.homedir(), '.codex')));
    const homeStat = await import('node:fs/promises').then(({ lstat }) => lstat(hostHome).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error)));
    if (homeStat?.isSymbolicLink() || (homeStat && !homeStat.isDirectory())) throw new TypeError('Codex home path is unsafe');
    const sessionsDirectory = options.sessionsDirectory ?? path.join(hostHome, 'sessions');
    const rulesRoot = options.rulesRoot ?? (streams.runtime?.resourceRoot ?? hostHome);
    options.skillFile = path.join(hostHome, 'skills', 'sdd-diagnose', 'SKILL.md');
    const result = await runBundle({
      project, home: hostHome, sessionsDirectory, rulesRoot,
      days: options.days, limit: options.limit, expectedMode: options.expectedMode,
      expectedRoles: options.expectedRoles, output: options.output, skillFile: options.skillFile,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`sdd-diagnose: ${error?.name ?? 'Error'}; no successful bundle reported. Check observer installation, project/session paths and private output permissions.\n`);
    return 1;
  }
}
