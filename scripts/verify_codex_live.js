#!/usr/bin/env node
// Opt-in real inference, never part of core/full or routine dispatch.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseToml } from '../lib/installation/toml.js';
import { readRollout, sessionIdentity, linkTaskAliases } from '../lib/observation/trace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

export function parseLiveArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  const result = { run: false, reanalyze: false, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') result.run = true;
    else if (argv[i] === '--reanalyze') result.reanalyze = true;
    else if (argv[i] === '--output' && argv[i + 1] && !argv[i + 1].startsWith('--')) result.output = path.resolve(argv[++i]);
    else throw new Error('Usage: node scripts/verify_codex_live.js --run --output PRIVATE_DIR');
  }
  if (result.run === result.reanalyze || !result.output) throw new Error('Explicit --run and --output required; this test makes paid model requests.');
  return result;
}

export function extractLiveEvents(stdout) {
  let thread = null, usage = null;
  for (const line of stdout.split('\n')) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (row.type === 'thread.started' && /^[a-f0-9-]{36}$/u.test(row.thread_id ?? '')) thread = row.thread_id;
    if (row.type === 'turn.completed') {
      const candidate = row.usage ?? {};
      if (['input_tokens', 'cached_input_tokens', 'output_tokens'].every(key => Number.isSafeInteger(candidate[key]) && candidate[key] >= 0) && candidate.cached_input_tokens <= candidate.input_tokens) usage = { input_tokens: candidate.input_tokens, cached_input_tokens: candidate.cached_input_tokens, output_tokens: candidate.output_tokens };
    }
  }
  return { thread, usage, usage_scope: 'root_cli_only_child_usage_not_included' };
}

function guardOutput(output) {
  if (fs.existsSync(output)) throw new Error('Output must be a new private directory; existing contents are never replaced.');
  for (let cursor = path.dirname(output); ; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Symlink output refused.');
    if (fs.existsSync(path.join(cursor, '.git'))) throw new Error('Keep live evidence outside Git trees.');
    if (path.dirname(cursor) === cursor) break;
  }
}
function snapshot(root) {
  const result = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected fixture symlink.');
    if (entry.isDirectory()) for (const [name, value] of Object.entries(snapshot(target))) result[`${entry.name}/${name}`] = value;
    else result[entry.name] = hash(fs.readFileSync(target));
  }
  return result;
}
function modelRun(args, cwd, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '', bytes = 0; const start = performance.now();
    const timer = setTimeout(() => child.kill('SIGTERM'), 240_000);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 245_000);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes <= 16 * 1024 * 1024) stdout += chunk; else child.kill('SIGTERM'); });
    // Drain without storing auth/provider error text or dialogue.
    child.stderr.on('data', () => {});
    child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(new Error(`Codex process start failed: ${error.code ?? 'unknown'}`)); });
    child.once('close', (code, signal) => { clearTimeout(timer); clearTimeout(killTimer); resolve({ code, signal, wall_ms: performance.now() - start, ...extractLiveEvents(stdout) }); });
    child.stdin.on('error', () => {}); child.stdin.end(prompt);
  });
}
function findTrace(root, id) {
  if (!id || !fs.existsSync(root)) return null;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const target = path.join(root, e.name);
    if (e.isDirectory()) { const match = findTrace(target, id); if (match) return match; }
    else if (e.name.endsWith(`-${id}.jsonl`)) return target;
  }
  return null;
}
function scopedChildHeaders(root, parent) {
  if (!fs.existsSync(root)) return [];
  const headers = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const file = path.join(root, e.name);
    if (e.isDirectory()) { headers.push(...scopedChildHeaders(file, parent)); continue; }
    if (!e.name.endsWith('.jsonl')) continue;
    const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(1024 * 1024);
    let count; try { count = fs.readSync(fd, bytes, 0, bytes.length, 0); } finally { fs.closeSync(fd); }
    const end = bytes.subarray(0, count).indexOf(10); if (end < 0) continue;
    try {
      const row = JSON.parse(bytes.subarray(0, end).toString('utf8'));
      if (row.type !== 'session_meta') continue;
      const identity = sessionIdentity(row.payload);
      if (identity.parent === parent) headers.push(identity);
    } catch { /* unrelated or invalid header contributes no authority */ }
  }
  return headers;
}
export async function traceSummary(home, thread) {
  const file = findTrace(path.join(home, 'sessions'), thread);
  if (!file) return { status: 'missing', agents: [], tool_counts: {}, usage: null };
  const trace = await readRollout(file);
  const day = path.dirname(file), parts = path.relative(path.join(home, 'sessions'), day).split(path.sep);
  const headers = scopedChildHeaders(day, trace.id);
  if (parts.length === 3 && /^\d{4}$/u.test(parts[0]) && /^\d{2}$/u.test(parts[1]) && /^\d{2}$/u.test(parts[2])) {
    const next = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1));
    const nextDay = path.join(home, 'sessions', String(next.getUTCFullYear()), String(next.getUTCMonth() + 1).padStart(2, '0'), String(next.getUTCDate()).padStart(2, '0'));
    headers.push(...scopedChildHeaders(nextDay, trace.id));
  }
  const links = linkTaskAliases(trace.events.map(e => ({ ...e, session: trace.id })), headers);
  const tools = links.events.filter(e => e.kind === 'tool');
  const counts = {}; for (const tool of tools) { const kind = tool.fact?.kind ?? 'unknown'; counts[kind] = (counts[kind] ?? 0) + 1; }
  const agents = [];
  for (const event of tools.filter(e => e.fact?.kind === 'agent.spawn')) {
    const childFile = findTrace(path.join(home, 'sessions'), event.fact.child);
    const child = childFile ? await readRollout(childFile) : null;
    agents.push({ role: event.fact.role, status: event.status, fork_turns: event.fact.fork_turns, child: event.fact.child ?? null,
      context: child?.events.filter(e => e.kind === 'context').map(e => ({ model: e.model, effort: e.effort })) ?? [],
      turns: child?.turns.length ?? null,
      usage: child?.events.filter(e => e.kind === 'usage.total').at(-1)?.usage ?? null });
  }
  const issues = [...new Set([...trace.issues, ...links.issues])];
  return { status: issues.length ? 'partial' : 'observed', issues,
    tool_counts: counts, agents, usage: trace.events.filter(e => e.kind === 'usage.total').at(-1)?.usage ?? null };
}
function acceptance(cwd) {
  const r = spawnSync(process.execPath, ['--test', 'baseline.test.js', 'acceptance.test.js'], { cwd, encoding: 'utf8', timeout: 15_000 });
  if (r.error) throw new Error('Acceptance command failed to start.');
  return r.status;
}

export async function verifyCodexLive({ output }) {
  guardOutput(output); fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const home = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const fixtureBytes = fs.readFileSync(path.join(ROOT, 'sdd-init/references/collaboration-benchmark.json'));
  const fixture = JSON.parse(fixtureBytes), test = fixture.cases.find(c => c.scenario === 'local-fix').acceptance_test;
  const config = parseToml(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'));
  const disableMcp = Object.keys(config.mcp_servers ?? {}).filter(n => /^[a-zA-Z0-9_-]+$/u.test(n)).flatMap(n => ['-c', `mcp_servers.${n}.enabled=false`]);
  const result = { schema_version: 1, mode: 'quick', evidence: 'real_native_model_runs', fixture_sha256: hash(fixtureBytes), arms: [],
    limitations: ['One tiny known-defect sample does not establish general savings.', 'No pricing supplied; monetary cost unknown.', 'Raw prompts, responses, reasoning and credentials are not copied into this report.', 'CLI usage is root-only unless confirmed child usage is present; wall time includes CLI startup and reasoning, excludes setup/reporting.'] };
  for (const delegated of [false, true]) {
    const name = delegated ? 'main_explorer' : 'main', cwd = path.join(output, name); fs.mkdirSync(cwd);
    for (const [file, text] of Object.entries({ ...fixture.baseline_files, 'acceptance.test.js': test })) { const target = path.join(cwd, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
    const before = snapshot(cwd); if (acceptance(cwd) !== 1) throw new Error('Known baseline defect not reproduced.');
    const prompt = `这是用户明确授权的Quick本机验证，只操作当前夹具，不改Home，不联网调查、不建Change/Task/Delivery/docs或git仓库，不加载无关技能。目标：修复store.get，使字符串键空格/大小写不敏感，缺失仍undefined；保留normalize(null)===''。现有baseline.test.js和acceptance.test.js不可改，允许必要src修复。${delegated ? '这是最小多Agent执行验证（不是净收益声明）：先用configured explorer、fork_turns="none"、task_name="explorer_live_store"只读定位读写差异，返回最小行号证据；待其结果后复用原agent补充normalize(null)边界证据（增量继续，不新建agent）。不得在spawn传model/effort。Main消化结果后实施和验证，不再完整重复调查。' : '由当前Main直接完成，不启动任何子Agent。'}修复后Main运行node --test baseline.test.js acceptance.test.js；完成用简短摘要返回，真实失败如实报告。`;
    const run = await modelRun(['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', cwd, ...disableMcp, '-'], cwd, prompt);
    const after = snapshot(cwd), trace = await traceSummary(home, run.thread);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
    const actual = acceptance(cwd), forbiddenDocs = changed.filter(p => /(^|\/)(docs|C0[1-4]-|Task|Delivery)|\.md$/iu.test(p));
    const testsIntact = ['baseline.test.js', 'acceptance.test.js'].every(p => before[p] === after[p]);
    const expectedExplorer = parseToml(fs.readFileSync(path.join(home, 'agents/explorer.toml'), 'utf8'));
    const successfulAgents = trace.agents.filter(a => a.status === 'success' && a.role === 'explorer' && a.fork_turns === 'none' && a.context.some(c => c.model === expectedExplorer.model && c.effort === expectedExplorer.model_reasoning_effort));
    const dispatchGood = delegated ? successfulAgents.length === 1 && (trace.tool_counts['agent.resume'] ?? 0) >= 1 : trace.agents.length === 0 && trace.status !== 'missing';
    result.arms.push({ name, ...run, trace, changed_files: changed, acceptance_exit: actual, tests_intact: testsIntact,
      new_formal_documents: forbiddenDocs.length, verified: run.code === 0 && actual === 0 && testsIntact && !forbiddenDocs.length && dispatchGood });
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n', { mode: 0o600 });
  }
  return result;
}

export async function reanalyzeLive({ output }) {
  const file = path.join(output, 'result.json');
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('Symlink evidence refused.');
    if (cursor === file && (!stat.isFile() || stat.size > 8 * 1024 * 1024)) throw new Error('Invalid evidence.');
    if (path.dirname(cursor) === cursor) break;
  }
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (result.schema_version !== 1 || result.evidence !== 'real_native_model_runs' || !Array.isArray(result.arms) || result.arms.length !== 2) throw new Error('Not a live trial report.');
  const home = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const expected = parseToml(fs.readFileSync(path.join(home, 'agents/explorer.toml'), 'utf8'));
  for (const arm of result.arms) {
    if (!['main', 'main_explorer'].includes(arm.name) || !/^[a-f0-9-]{36}$/u.test(arm.thread ?? '')) throw new Error('Invalid trial identity.');
    arm.trace = await traceSummary(home, arm.thread);
    const children = arm.trace.agents.filter(a => a.status === 'success' && a.role === 'explorer' && a.fork_turns === 'none'
      && a.context.some(c => c.model === expected.model && c.effort === expected.model_reasoning_effort));
    const dispatch = arm.name === 'main' ? arm.trace.agents.length === 0 && arm.trace.status !== 'missing'
      : children.length === 1 && children[0].turns >= 2 && (arm.trace.tool_counts['agent.resume'] ?? 0) >= 1;
    arm.verified = arm.code === 0 && arm.acceptance_exit === 0 && arm.tests_intact === true && arm.new_formal_documents === 0 && dispatch;
    arm.usage_observed = [{ role: 'main', usage: arm.trace.usage }, ...arm.trace.agents.map(a => ({ role: a.role, usage: a.usage }))];
  }
  result.reanalysis_basis = 'same completed native traces; no additional model request, no new code execution or fresh acceptance';
  fs.writeFileSync(file, JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n', { mode: 0o600 });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseLiveArgs(process.argv.slice(2));
    if (args.help) process.stdout.write('Usage: node scripts/verify_codex_live.js --run|--reanalyze --output PRIVATE_DIR\nReanalysis reads existing metadata without model calls. Opt-in paid real inference. No Home/model overrides; root/child usage scopes are separate.\n');
    else { const result = args.reanalyze ? await reanalyzeLive(args) : await verifyCodexLive(args); process.stdout.write(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n'); process.exitCode = result.arms.every(a => a.verified) ? 0 : 1; }
  } catch { process.stderr.write('Live verification failed; no semantic/cost success claimed. Check private metadata and host configuration.\n'); process.exitCode = 1; }
}
