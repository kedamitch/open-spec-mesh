import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, UsageError } from '../cli/args.js';
import { resolveRuntime } from '../runtime/location.js';
import { parseLosslessJson } from '../runtime/compat-json.js';

export function collaborationScenarios() {
  const root = resolveRuntime(import.meta.url).resourceRoot;
  return JSON.parse(fs.readFileSync(path.join(root, 'sdd-init/references/collaboration-scenarios.json'), 'utf8')).scenarios;
}

/** Checks explicit trace facts only; never routes work or judges semantic intent. */
export function evaluateCollaboration(run, scenarioId) {
  const scenario = collaborationScenarios().find(item => item.id === scenarioId);
  if (!scenario) throw new UsageError('Unknown collaboration scenario');
  if (!run || !Array.isArray(run.events) || !Array.isArray(run.sessions) || !run.coverage) throw new TypeError('Expected a normalized observation report, not raw conversation');
  const full = run.coverage.status === 'observed';
  const tools = run.events.filter(event => event.kind === 'tool');
  const spawns = tools.filter(event => event.fact?.kind === 'agent.spawn');
  const verified = tools.filter(event => event.fact?.kind === 'verification.run' && event.status === 'success');
  const unknownTools = tools.some(event => !event.fact?.kind || ['opaque', 'other.command', 'other.tool'].includes(event.fact.kind));
  const observationsComplete = full && !unknownTools;
  const checks = [], rules = scenario.rules;
  const bounded = (name, count, limit) => checks.push({ name, status: count > limit ? 'fail' : observationsComplete ? 'pass' : 'unknown', count, limit });
  if (rules.spawn_budget != null) bounded('spawn_budget', spawns.length, rules.spawn_budget);
  if (rules.allowed_spawn_roles) {
    const violation = spawns.some(event => event.fact.role !== 'unknown' && !rules.allowed_spawn_roles.includes(event.fact.role));
    const unknown = spawns.some(event => event.fact.role === 'unknown');
    checks.push({ name: 'allowed_spawn_roles', status: violation ? 'fail' : observationsComplete && !unknown ? 'pass' : 'unknown' });
  }
  if (rules.forbidden_spawn_roles) {
    bounded('forbidden_spawn_roles', spawns.filter(event => rules.forbidden_spawn_roles.includes(event.fact.role)).length, 0);
    if (checks.at(-1).status === 'pass' && spawns.some(event => event.fact.role === 'unknown')) checks.at(-1).status = 'unknown';
  }
  if (rules.forbidden_kinds) bounded('unnecessary_replanning', tools.filter(event => rules.forbidden_kinds.includes(event.fact?.kind)).length, 0);
  if (rules.requires_verification) checks.push({ name: 'verification_succeeded', status: verified.length ? 'pass' : observationsComplete ? 'fail' : 'unknown', count: verified.length });
  if (rules.integration_budget != null) bounded('integration_budget', tools.filter(event => event.fact?.kind === 'verification.run' && event.fact.scope === 'integration').length, rules.integration_budget);
  if (rules.integration_owner) {
    const roles = new Map(run.sessions.map(session => [session.id, session.role]));
    const integration = tools.filter(event => event.fact?.kind === 'verification.run' && event.fact.scope === 'integration');
    const knownRoles = ['main', 'architect', 'worker', 'reviewer', 'explorer', 'librarian'];
    const knownWrong = integration.some(event => knownRoles.includes(roles.get(event.session)) && roles.get(event.session) !== rules.integration_owner);
    checks.push({ name: 'integration_owner', status: knownWrong ? 'fail' : integration.length && observationsComplete && integration.every(event => roles.get(event.session) === rules.integration_owner) ? 'pass' : 'unknown' });
  }
  return {
    schema_version: 1, scenario: scenario.id, evidence_level: 'normalized_trace_checks', additional_model_calls: 0,
    status: checks.some(check => check.status === 'fail') ? 'supported_check_failed' : checks.some(check => check.status === 'unknown') || !checks.length ? 'incomplete' : 'supported_checks_passed',
    semantic_quality: 'unverified', checks,
    human_checks: scenario.human_checks.map(question => ({ question, status: 'unverified' })),
    limitations: ['Checks evaluate recorded actions against explicit scenario expectations, not whether an LLM reliably follows prompts.',
      'Synthetic fixtures do not prove actual model quality, cost savings, authorization or human acceptance.',
      'Absent actions in partial or opaque traces remain unknown; semantic judgment requires a human.'],
  };
}

/** Presentation only: supported actions passing never implies semantic acceptance. */
export function renderCollaborationMarkdown(report) {
  const label = {
    supported_checks_passed: 'Supported action checks passed / 已支持的动作检查通过',
    supported_check_failed: 'Supported action check failed / 动作检查失败',
    incomplete: 'Incomplete evidence / 证据不完整',
  }[report.status];
  const lines = [
    '# Collaboration evaluation / 协作评估', '',
    `**Status: ${report.status} — ${label}**`, '',
    `- Scenario: ${report.scenario}`,
    `- Evidence level: ${report.evidence_level}`,
    `- Semantic quality: ${report.semantic_quality} / 语义质量未验证`,
    `- Additional model calls by this evaluator: ${report.additional_model_calls}`,
    '- Human acceptance / 人工验收: unverified', '',
    '> This is not full quality approval, authorization or proof of savings. / 这不是整体质量、授权或节省证明。', '',
    '## Action checks / 动作检查', '',
    '| Check | Status | Observed count | Budget |', '|---|---|---:|---:|',
    ...report.checks.map(check => `| ${check.name} | ${check.status} | ${check.count ?? 'not applicable'} | ${check.limit ?? 'not applicable'} |`),
  ];
  if (!report.checks.length) lines.push('', 'No automated checks for this scenario / 此场景没有可自动检查项。');
  if (report.status === 'incomplete') lines.push('', '> Unknown is not a pass. / unknown 不是通过；默认 exit 0 仍须读取 status，可用 --fail-on-incomplete 返回 3。');
  lines.push('', '## Human checks / 待人工核对', '',
    ...report.human_checks.map(check => `- [${check.status}] ${check.question}`),
    '', '## Limitations / 证据限制', '', ...report.limitations.map(item => `- ${item}`));
  return lines.join('\n') + '\n';
}

function renderScenarioListMarkdown(scenarios) {
  return ['# Collaboration scenarios / 协作场景', '',
    ...scenarios.map(scenario => `- **${scenario.id}**: ${scenario.intent}`), '',
    'Listing scenarios is not an evaluation or human acceptance. / 列表不执行评估，也不是人工验收。', ''].join('\n');
}

export async function runEvaluateCollaboration(argv = [], io = {}) {
  const args = parseArgs(argv, { options: { report: {}, scenario: {}, list: { kind: 'boolean' }, format: { default: 'json' }, 'fail-on-incomplete': { kind: 'boolean' } } });
  const stdout = io.stdout ?? process.stdout;
  if (args.help) { stdout.write('Usage: open-spec-mesh evaluate-collaboration --report NORMALIZED_JSON --scenario ID [--format json|md] [--fail-on-incomplete]\n       open-spec-mesh evaluate-collaboration --list [--format json|md]\nDefault format: json. Exit: 0 supported action checks passed or incomplete (default); 1 action check failed; 2 invalid arguments; 3 incomplete with --fail-on-incomplete.\nRead-only evaluation; semantic quality and human acceptance remain unverified. Does not call models, route tasks or approve stages.\n'); return 0; }
  if (!['json', 'md'].includes(args.format)) throw new UsageError('--format must be json or md');
  if (args.list) {
    const scenarios = collaborationScenarios();
    stdout.write(args.format === 'md' ? renderScenarioListMarkdown(scenarios) : JSON.stringify(scenarios, null, 2) + '\n');
    return 0;
  }
  if (!args.report || !args.scenario) throw new UsageError('--report and --scenario are required');
  const file = path.resolve(args.report);
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new TypeError('Symlink report refused');
    if (cursor === file && (!stat.isFile() || stat.size > 8 * 1024 * 1024)) throw new TypeError('Invalid or oversized report file');
    if (path.dirname(cursor) === cursor) break;
  }
  let run;
  try { run = parseLosslessJson(fs.readFileSync(file, 'utf8')); } catch { throw new TypeError('Invalid normalized report JSON'); }
  const report = evaluateCollaboration(run, args.scenario);
  stdout.write(args.format === 'md' ? renderCollaborationMarkdown(report) : JSON.stringify(report, null, 2) + '\n');
  if (report.status === 'supported_check_failed') return 1;
  return report.status === 'incomplete' && args['fail-on-incomplete'] ? 3 : 0;
}
