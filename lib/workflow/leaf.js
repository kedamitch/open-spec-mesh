import path from 'node:path';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parse as parseToml } from 'smol-toml';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeError } from '../cli/output.js';

export const HOSTS = ['auto', 'codex', 'opencode', 'claude'];
export const LEAVES = ['worker', 'reviewer', 'explorer', 'librarian'];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function uuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value); }
function executablePath(name, env = process.env) {
  for (const directory of String(env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* Match PATH lookup: skip missing, non-file and non-executable entries. */ }
  }
  return null;
}
function projectDirectory(project, message = 'Project directory missing') {
  const cwd = path.resolve(project);
  try { if (!statSync(cwd).isDirectory()) throw new Error(message); }
  catch (error) { if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new Error(message); throw error; }
  return cwd;
}
function expandHome(value, home) {
  const text = String(value);
  if (text === '~') return home;
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(home, text.slice(2));
  return text;
}
export function rolePath(role) {
  if (!LEAVES.includes(role)) throw new Error('Only leaf roles are permitted');
  for (const base of [packageRoot, path.dirname(packageRoot)]) {
    const candidate = path.join(base, 'agents', `${role}.toml`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Installed role file missing');
}
export function codexCommand(binary, roleFile, project, resume = null) {
  const data = parseToml(readFileSync(roleFile, 'utf8'));
  if (!LEAVES.includes(data.name)) throw new Error('Architect/Main cannot use the leaf launcher');
  const cwd = projectDirectory(project);
  if (resume && !uuid(resume)) throw new Error('Invalid Codex session UUID');
  const overrides = {};
  for (const key of ['model', 'model_reasoning_effort', 'developer_instructions', 'sandbox_mode']) if (data[key] !== undefined) overrides[key] = data[key];
  Object.assign(overrides, { 'agents.enabled': false, 'features.multi_agent': false, 'features.multi_agent_v2': false });
  const args = [binary, '-C', cwd];
  for (const [key, value] of Object.entries(overrides)) args.push('-c', `${key}=${JSON.stringify(value)}`);
  args.push('exec');
  if (resume) args.push('resume', resume);
  args.push('--json', '--skip-git-repo-check', '-');
  return args;
}
export function defaultHome(host, env = process.env, home = env.HOME || homedir()) {
  if (host === 'codex') return expandHome(env.CODEX_HOME || path.join(home, '.codex'), home);
  if (host === 'opencode') return expandHome(env.OPENCODE_CONFIG_DIR || path.join(home, '.config/opencode'), home);
  if (host === 'claude') return expandHome(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), home);
  throw new Error(`Unknown host: ${host}`);
}
export function resolveHost(host, env = process.env) {
  if (host !== 'auto') {
    if (!HOSTS.slice(1).includes(host)) throw new Error(`Unknown host: ${host}`);
    return host;
  }
  const explicit = String(env.OPEN_SPEC_MESH_HOST ?? '').trim().toLowerCase();
  if (explicit) {
    if (!HOSTS.slice(1).includes(explicit)) throw new Error('Invalid OPEN_SPEC_MESH_HOST');
    return explicit;
  }
  if (executablePath('codex', env)) return 'codex';
  const available = ['opencode', 'claude'].filter((name) => executablePath(name, env));
  if (available.length === 1) return available[0];
  if (!available.length) throw new Error('No supported host CLI installed');
  throw new Error('Multiple host CLIs installed; use --host');
}
function sessionId(host, value) {
  if (!value) return null;
  if (host === 'codex') {
    if (!uuid(value)) throw new Error('Invalid Codex session UUID');
  } else if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{5,255}$/u.test(value) || /[\r\n]/u.test(value)) throw new Error('Invalid session id');
  return value;
}
export function hostCommand(host, binary, role, project, resume = null, home = null, env = process.env) {
  if (!LEAVES.includes(role)) throw new Error('Only leaf roles are permitted');
  const cwd = projectDirectory(project);
  resume = sessionId(host, resume);
  home = home ? expandHome(home, env.HOME || homedir()) : defaultHome(host, env);
  if (host === 'codex') return { argv: codexCommand(binary, rolePath(role), cwd, resume), env: {} };
  if (host === 'opencode') return { argv: [binary, 'run', '--agent', role, '--format', 'json', ...(resume ? ['--session', resume] : [])], env: { OPENCODE_CONFIG_DIR: home, OPENCODE_CONFIG: path.join(home, 'open-spec-mesh.opencode.json') } };
  if (host === 'claude') return { argv: [binary, '-p', '--agent', role, '--output-format', 'stream-json', '--verbose', '--mcp-config', path.join(home, 'open-spec-mesh.mcp.json'), ...(resume ? ['--resume', resume] : [])], env: {} };
  throw new Error(`Unknown host: ${host}`);
}
export function runLeafCommand(role, { host = 'auto', hostHome = null, root = process.cwd(), prompt, resume = null, timeout = 900, env = process.env } = {}) {
  const selected = resolveHost(host, env);
  const binary = executablePath(selected, env);
  if (!binary) throw new Error(`${selected} CLI not installed`);
  if (!Number.isInteger(timeout) || timeout < 1) throw new Error('Timeout must be positive');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Task prompt is empty');
  const cwd = projectDirectory(root);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Task prompt is empty');
  if (!Number.isInteger(timeout) || timeout < 1) throw new Error('Timeout must be positive');
  const built = hostCommand(selected, binary, role, cwd, resume, hostHome, env);
  const argv = selected === 'codex' ? built.argv : [...built.argv, prompt];
  const completed = spawnSync(argv[0], argv.slice(1), {
    cwd, env: { ...env, ...built.env }, ...(selected === 'codex' ? { input: prompt } : {}), encoding: 'utf8', timeout: timeout * 1000,
    maxBuffer: 64 * 1024 * 1024, shell: false,
  });
  if (completed.error) throw new Error(`${selected} CLI failed: ${completed.error.message}`);
  return { host: selected, status: completed.status ?? 1, stdout: completed.stdout ?? '', stderr: completed.stderr ?? '' };
}
export async function runLeaf(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, {
      positionals: ['role'],
      options: {
        host: { kind: 'value', default: 'auto' }, 'host-home': { kind: 'value' }, root: { kind: 'value', default: process.cwd() },
        'prompt-file': { kind: 'value' }, resume: { kind: 'value' }, timeout: { kind: 'value', default: '900' },
      },
      command: 'run-leaf',
    });
    if (args.help) { stdout.write('Usage: open-spec-mesh run-leaf ROLE [--host auto|codex|opencode|claude] --prompt-file FILE [--resume SESSION]\n'); return 0; }
    if (!LEAVES.includes(args.role)) throw new UsageError(`role must be one of: ${LEAVES.join(', ')}`);
    if (!args['prompt-file']) throw new UsageError('--prompt-file is required');
    const prompt = readFileSync(args['prompt-file'], 'utf8');
    const result = runLeafCommand(args.role, { host: args.host, hostHome: args['host-home'], root: args.root, prompt, resume: args.resume, timeout: Number(args.timeout) });
    stdout.write(result.stdout);
    stderr.write(result.stderr);
    return result.status;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
