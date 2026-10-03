import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, UsageError } from '../cli/args.js';
import { resolveRuntime } from '../runtime/location.js';
import { parseToml } from './toml.js';
import { HOSTS, ROLES, hostProfile, loadRole } from './host-adapter.js';

const LIMIT = 2 * 1024 * 1024;
// A deliberately restricted report: never read auth files, environment values or
// secret fields, and never return parser messages or configuration text.
function safeLabel(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_./:+-]{0,159}$/u.test(value)
    && !/^(?:sk-|gh[pousr]_|github_pat_)/u.test(value) ? value : null;
}
function readConfig(home, relative, parse) {
  if (typeof relative !== 'string') return { status: 'unregistered' };
  const target = path.resolve(home, relative), rel = path.relative(home, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return { status: 'outside_home' };
  if (!/^[a-zA-Z0-9_./-]{1,240}$/u.test(rel) || /(?:^|[/])(?:auth|credentials|secrets)(?:[./]|$)/u.test(rel)) return { status: 'unsupported_path' };
  try {
    // Do not follow redirects to unrelated user files.
    for (let cursor = target; ; cursor = path.dirname(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) return { status: 'symlink_refused' };
      if (cursor === target && (!stat.isFile() || stat.size > LIMIT)) return { status: 'unsupported_file' };
      if (cursor === home) break;
    }
    return { status: 'read', data: parse(fs.readFileSync(target, 'utf8')) };
  } catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unreadable_or_invalid' }; }
}
function markdownHeader(text) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1] ?? '';
  const model = /^model:\s*([a-zA-Z0-9_./:+-]+)\s*$/mu.exec(header)?.[1] ?? null;
  return { model };
}

/** File evidence only: not a host precedence resolver or a live-session probe. */
export function inspectHost({ host = 'codex', home, source = resolveRuntime(import.meta.url).resourceRoot } = {}) {
  const profile = hostProfile(host, home);
  const root = profile.home;
  const config = host === 'codex' ? readConfig(root, 'config.toml', parseToml) : { status: 'not_inspected', data: null };
  const settings = config.data ?? {};
  const marker = readConfig(root, 'open-spec-mesh/runtime/.open-spec-mesh-runtime.json', JSON.parse);
  const version = marker.data?.schema === 1 && marker.data?.name === 'open-spec-mesh' ? safeLabel(marker.data?.version) : null;
  const roles = ROLES.map((role) => {
    const expected = loadRole(source, role);
    const registered = host === 'codex' ? settings.agents?.[role]?.config_file : `agents/${role}.md`;
    const file = readConfig(root, registered, host === 'codex' ? parseToml : markdownHeader);
    const model = safeLabel(file.data?.model), effort = safeLabel(file.data?.model_reasoning_effort);
    const relative = typeof registered === 'string' && !['outside_home', 'unsupported_path'].includes(file.status)
      ? path.relative(root, path.resolve(root, registered)) : null;
    const comparison = host !== 'codex' ? 'host_inheritance_not_resolved' : file.status !== 'read' || !model || !effort
      ? 'unknown' : model === expected.model && effort === expected.model_reasoning_effort ? 'matches_package' : 'differs_from_package';
    return { role, file: relative, status: file.status, model, effort, package_model: host === 'codex' ? expected.model : null,
      package_effort: host === 'codex' ? expected.model_reasoning_effort : null, comparison };
  });
  return {
    schema_version: 1, host, basis: 'installed_files_only', package_version: version,
    config_status: config.status, runtime_marker_status: marker.status,
    main: { model: safeLabel(settings.model), effort: safeLabel(settings.model_reasoning_effort), comparison: 'user_override_allowed' },
    subagent_defaults: {
      model: safeLabel(settings.agents?.default_subagent_model),
      effort: safeLabel(settings.agents?.default_subagent_reasoning_effort),
      package_model: host === 'codex' ? safeLabel(parseToml(fs.readFileSync(path.join(source, 'config.toml'), 'utf8')).agents?.default_subagent_model) : null,
      warning: host === 'codex' && settings.agents?.default_subagent_model === 'gpt-5.6-luna' ? 'legacy_default_requires_explicit_migration' : null,
    },
    roles, live_session: { status: 'unknown', model: null, effort: null },
    limitations: [
      'File values do not prove what an existing session loaded; restart/reload behavior must be checked in the actual host.',
      'CLI flags, project layers, profiles, managed policies and provider availability are not resolved.',
      'A difference from package defaults may be an intentional customization; no files were modified.',
      'OpenCode/Claude model inheritance and native configuration are not resolved; only managed role frontmatter is inspected.',
    ],
  };
}

export function inspectMarkdown(report) {
  const lines = ['# 宿主配置核验', '', `Host: ${report.host}; basis: installed_files_only; package: ${report.package_version ?? 'unknown'}.`,
    '', '当前活动会话：unknown。此命令只核对安装文件，不证明当前会话已加载，不检查认证或模型可用性。',
    '', `Subagent default: ${report.subagent_defaults.model ?? 'unknown'} / ${report.subagent_defaults.effort ?? 'unknown'}; warning: ${report.subagent_defaults.warning ?? 'none'}`,
    '', `Main: ${report.main.model ?? 'unknown'} / ${report.main.effort ?? 'unknown'}（允许用户覆盖）`, '',
    '| Role | File | Status | File model / effort | Comparison |', '| --- | --- | --- | --- | --- |'];
  for (const r of report.roles) lines.push(`| ${r.role} | ${String(r.file ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${r.status} | ${r.model ?? 'unknown'} / ${r.effort ?? 'unknown'} | ${r.comparison} |`);
  if (report.subagent_defaults.warning === 'legacy_default_requires_explicit_migration') {
    lines.push('', '## 旧默认模型恢复', '',
      'Codex 0.159.3 会先校验默认子代理模型，再加载角色 TOML；角色文件一致不能绕过旧默认值校验。此处只报告文件风险，不判断供应商模型可用性。',
      '需显式授权后对同一个 Home 执行 install --host codex --migrate-legacy-agent-defaults；仅迁移旧默认，不改变 Main、其他自定义模型或 effort。',
      '安装完成不证明当前 turn 的配置快照已更新。在实际宿主加载新配置后验证 configured agent_type + fork_turns=none 的真实派发及子会话 model/effort；不要在 spawn 时覆盖模型，不密集重试，也不自动中断其他会话。');
  }
  return lines.concat('', ...report.limitations.map((item) => `- ${item}`), '').join('\n');
}

export async function runInspectHost(argv = [], io = {}) {
  const args = parseArgs(argv, { command: 'inspect-host', options: {
    host: { default: 'codex' }, home: {}, format: { default: 'md' },
  } });
  const stdout = io.stdout ?? process.stdout;
  if (args.help) { stdout.write('Usage: open-spec-mesh inspect-host [--host codex|opencode|claude] [--home DIR] [--format md|json]\nRead-only, installed files only; no live-session, credentials or provider probe.\n'); return 0; }
  if (!HOSTS.includes(args.host) || !['md', 'json'].includes(args.format)) throw new UsageError('Invalid inspect-host host or format');
  const report = inspectHost({ host: args.host, home: args.home });
  stdout.write(args.format === 'json' ? JSON.stringify(report, null, 2) + '\n' : inspectMarkdown(report));
  return 0;
}
