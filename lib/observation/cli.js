import os from 'node:os';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { legacyJson } from '../runtime/compat-json.js';
import { rootPath } from '../runtime/paths.js';
import { collect, collectHostSnapshot, scanRuns } from './collect.js';
import { diagnose, markdown, summary } from './diagnose.js';
import { groupRuns } from './diagnose.js';
import { withStore } from './store.js';
import { ROLES } from './trace.js';

function expand(value) {
  const text = String(value);
  if (text === '~') return os.homedir();
  if (text.startsWith(`~${path.sep}`)) return path.join(os.homedir(), text.slice(2));
  return text;
}
function takeValue(args, index, flag) {
  const value = args[index + 1];
  if (value == null || value.startsWith('--')) throw new TypeError(`${flag} requires a value`);
  return [value, index + 1];
}
function parseArgs(argv) {
  const args = [...argv];
  const options = { host: process.env.OPEN_SPEC_MESH_HOST || 'codex' };
  let index = 0;
  while (index < args.length && args[index].startsWith('--')) {
    const flag = args[index];
    if (flag === '--host' || flag === '--db') {
      const [value, next] = takeValue(args, index, flag);
      options[flag === '--host' ? 'host' : 'db'] = value; index = next + 1;
    } else if (flag === '--help' || flag === '-h') return { help: true };
    else throw new TypeError(`Unknown option: ${flag}`);
  }
  const command = args[index++];
  if (!['collect', 'scan', 'report', 'group', 'summary'].includes(command)) throw new TypeError('Expected collect, scan, report, group, or summary');
  const values = args.slice(index);
  const parsed = { ...options, command, expectrole: [], reworkmarks: [] };
  const strings = new Set(['--run', '--root', '--session-file', '--sessions-dir', '--rules-root', '--turn', '--change', '--expected-mode', '--since', '--format', '--max-runs']);
  const switches = new Set();
  while (values.length) {
    const flag = values.shift();
    if (flag === '--members') {
      parsed.members = [];
      while (values.length && !values[0].startsWith('--')) parsed.members.push(values.shift());
      if (!parsed.members.length) throw new TypeError('--members requires at least one run id');
    } else if (flag === '--rework-mark') {
      if (!values.length || values[0].startsWith('--')) throw new TypeError('--rework-mark requires ID:assumption|handoff|integration');
      parsed.reworkmarks.push(values.shift());
    } else if (flag === '--expect-role') {
      if (!values.length || values[0].startsWith('--')) throw new TypeError('--expect-role requires a value');
      parsed.expectrole.push(values.shift());
    } else if (strings.has(flag)) {
      if (!values.length || values[0].startsWith('--')) throw new TypeError(`${flag} requires a value`);
      parsed[flag.slice(2).replaceAll('-', '')] = values.shift();
    } else if (switches.has(flag)) parsed[flag.slice(2)] = true;
    else throw new TypeError(`Unknown option: ${flag}`);
  }
  return parsed;
}

export function observeHelp() {
  return [
    'Usage: open-spec-mesh observe [--host HOST] [--db PATH] <command> [options]',
    '',
    'Commands:',
    '  collect --run ID --root DIR [--session-file FILE] [--sessions-dir DIR] [--turn ID] [--change ID]',
    '          [--expected-mode unknown|quick|sdd (legacy alias: semi-auto)] [--expect-role ROLE]',
    '          [--rework-mark ID:assumption|handoff|integration] (optional operator evidence, never inferred)',
    '  scan --root DIR [--sessions-dir DIR] [--rules-root DIR] [--since YYYY-MM-DD] [--max-runs N]',
    '  report --run ID [--format md|json]',
    '  group --run ID --members ID [ID ...]',
    '  summary',
    '',
  ].join('\n');
}

async function gitRoot(directory) {
  for (let cursor = path.resolve(directory); ; cursor = path.dirname(cursor)) {
    try { await lstat(path.join(cursor, '.git')); return cursor; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) return path.resolve(directory);
  }
}

function emitJson(stream, value, { indent = null } = {}) {
  stream.write(`${legacyJson(value, { ensureAscii: false, indent })}\n`);
}

export async function runObserve(argv = [], streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  let args;
  try { args = parseArgs(argv); }
  catch (error) { stderr.write(`observe: ${error.message}\n`); return 2; }
  if (args.help) { stdout.write(observeHelp()); return 0; }
  const host = args.host;
  if (!['codex', 'opencode', 'claude'].includes(host)) { stderr.write('observe: unknown host\n'); return 2; }
  const home = host === 'codex' ? expand(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))
    : host === 'opencode' ? expand(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config/opencode'))
      : expand(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  const stateRoot = expand(process.env.OPEN_SPEC_MESH_STATE_HOME || path.join(process.env.XDG_STATE_HOME ? expand(process.env.XDG_STATE_HOME) : path.join(os.homedir(), '.local/state'), 'open-spec-mesh'));
  const database = path.resolve(expand(args.db || path.join(stateRoot, 'observations.sqlite3')));
  try {
    if (args.reworkmarks.length && args.command !== 'collect') throw new TypeError('--rework-mark is only supported by collect');
    if (args.reworkmarks.length > 16) throw new TypeError('At most 16 operator annotations per collection');
    const annotations = args.reworkmarks.map(mark => {
      const match = /^([A-Za-z0-9][A-Za-z0-9_.-]{0,79}):(assumption|handoff|integration)$/u.exec(mark);
      if (!match) throw new TypeError('Invalid --rework-mark; expected ID:assumption|handoff|integration');
      return { id: match[1], reason: match[2], source: 'operator_annotation' };
    });
    if (['collect', 'report', 'group'].includes(args.command) && !args.run) throw new TypeError('--run is required');
    if (args.command === 'group' && !args.members) throw new TypeError('--members is required');
    if (args.command === 'collect' || args.command === 'scan') {
      if (!args.root) throw new TypeError('--root is required');
      const project = rootPath(expand(args.root));
      const containmentRoot = await gitRoot(project);
      const relativeDb = path.relative(containmentRoot, database);
      if (relativeDb === '' || (relativeDb !== '..' && !relativeDb.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeDb))) throw new TypeError('Keep observation DB outside the project/Git tree');
      const rulesRoot = path.resolve(expand(args.rulesroot || home));
      if (args.command === 'scan') {
        if (host !== 'codex') throw new TypeError(`Native trace scan is unsupported for ${host}; use collect for artifact snapshot`);
        const sessionsDir = path.resolve(expand(args.sessionsdir || path.join(home, 'sessions')));
        const [runs, skipped] = await scanRuns(project, rulesRoot, sessionsDir, args.since || null, args.maxruns ? Number(args.maxruns) : 100);
        await withStore(database, (store) => { for (const [runId, run] of runs) store.save(runId, diagnose(run)); });
        emitJson(stdout, { runs: runs.map(([runId]) => runId), index_skipped: skipped, diagnostic_model_calls: 0 });
        return 0;
      }
      const mode = args.expectedmode || 'unknown';
      if (!['unknown', 'quick', 'semi-auto', 'sdd'].includes(mode)) throw new TypeError('Invalid --expected-mode');
      for (const role of args.expectrole) if (!ROLES.has(role) || role === 'main') throw new TypeError('Invalid --expect-role');
      let raw;
      if (host === 'codex') {
        if (!args.sessionfile) throw new TypeError('--session-file is required for codex trace collection');
        raw = await collect(project, rulesRoot, path.resolve(expand(args.sessionfile)), args.sessionsdir ? path.resolve(expand(args.sessionsdir)) : null, args.turn || null, args.change || null, mode, args.expectrole);
      } else {
        if (args.sessionfile || args.sessionsdir || args.turn) throw new TypeError(`Private session trace input is unsupported for ${host}`);
        raw = await collectHostSnapshot(project, rulesRoot, host, args.change || null, mode, args.expectrole);
      }
      if (annotations.length) raw.annotations = { rework: annotations };
      const run = diagnose(raw);
      const saved = await withStore(database, (store) => store.save(args.run, run));
      emitJson(stdout, { run: args.run, findings: saved.findings.length, coverage: saved.coverage, diagnostic_model_calls: 0 });
      return 0;
    }
    const storeExists = await import('node:fs/promises').then(({ lstat }) => lstat(database).then(() => true, (error) => error?.code === 'ENOENT' ? false : Promise.reject(error)));
    if (!storeExists) throw new TypeError('Observation database does not exist; collect first');
    await withStore(database, (store) => {
      if (args.command === 'group') {
        if (!args.run || !args.members) throw new TypeError('group requires --run and --members');
        const run = store.save(args.run, groupRuns(args.members.map((key) => store.load(key))));
        emitJson(stdout, { run: args.run, members: run.members, diagnostic_model_calls: 0 });
      } else if (args.command === 'summary') stdout.write(summary(store.allRuns()));
      else {
        if (!args.run) throw new TypeError('report requires --run');
        const run = store.load(args.run);
        if ((args.format || 'md') === 'json') emitJson(stdout, run, { indent: 2 });
        else if ((args.format || 'md') === 'md') stdout.write(markdown(run));
        else throw new TypeError('Invalid report format');
      }
    }, { create: false });
    return 0;
  } catch (error) {
    stderr.write(`observe: ${error?.name ?? 'Error'}: ${String(error?.message ?? 'operation failed').slice(0, 200)}\n`);
    return 1;
  }
}
