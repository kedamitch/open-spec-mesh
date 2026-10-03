import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { evaluateCollaboration, collaborationScenarios, runEvaluateCollaboration } from '../../../lib/observation/evaluation.js';
import { runCommand } from '../../../lib/cli/registry.js';
import { readRollout } from '../../../lib/observation/trace.js';
import { baseRows, endRow, envelope, writeRows, SECRET } from './helpers.js';
const event = (kind, fields = {}) => ({ kind: 'tool', status: 'success', session: 'main', fact: { kind, ...fields } });
const run = events => ({ events, sessions: [{ id: 'main', role: 'main' }, { id: 'worker', role: 'worker' }], coverage: { status: 'observed' } });

test('scenario checks detect unnecessary spawn and replanning from actions rather than prompt strings', () => {
  const good = run([event('implementation.write'), event('verification.run', { scope: 'targeted' })]);
  const bad = run([...good.events, event('agent.spawn', { role: 'explorer' })]);
  assert.equal(evaluateCollaboration(good, 'local-fix').status, 'supported_checks_passed');
  assert.equal(evaluateCollaboration(bad, 'local-fix').status, 'supported_check_failed');
  assert.equal(evaluateCollaboration(run([...good.events, event('design.create'), event('agent.spawn', { role: 'architect' })]), 'local-adjustment').status, 'supported_check_failed');
  assert.equal(evaluateCollaboration(run([event('agent.spawn', { role: 'worker' })]), 'bounded-investigation').status, 'supported_check_failed');
});

test('partial or opaque absence stays unknown and semantic escalation is never auto-approved', () => {
  const partial = run([]); partial.coverage.status = 'partial';
  assert.equal(evaluateCollaboration(partial, 'local-fix').checks.find(c => c.name === 'spawn_budget').status, 'unknown');
  assert.equal(evaluateCollaboration(run([event('opaque')]), 'local-fix').status, 'incomplete');
  const escalated = evaluateCollaboration(run([]), 'public-contract-change');
  assert.equal(escalated.status, 'incomplete'); assert.equal(escalated.semantic_quality, 'unverified');
  assert.ok(escalated.human_checks.every(c => c.status === 'unverified'));
});

test('reuse and validation ownership expose unnecessary model work and repeated integration', () => {
  assert.equal(evaluateCollaboration(run([event('agent.status'), event('agent.resume')]), 'reuse-existing-session').status, 'supported_checks_passed');
  const wrong = run([{ ...event('verification.run', { scope: 'integration' }), session: 'worker' }]);
  assert.equal(evaluateCollaboration(wrong, 'validation-ownership').checks.find(c => c.name === 'integration_owner').status, 'fail');
  const repeated = run([event('verification.run', { scope: 'integration' }), event('verification.run', { scope: 'integration' })]);
  assert.equal(evaluateCollaboration(repeated, 'validation-ownership').checks.find(c => c.name === 'integration_budget').status, 'fail');
});

test('synthetic native trace replay checks actual parsed actions and explicitly does not prove model quality', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-eval-fixture-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'fixture.jsonl');
  await writeRows(file, [...baseRows('main'),
    envelope('response_item', { type: 'function_call', call_id: 'test', name: 'exec_command', arguments: JSON.stringify({ cmd: 'node --test tests/fix.test.js', private: SECRET }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'test', output: JSON.stringify({ exit_code: 0, text: SECRET }) }, 4), endRow()]);
  const trace = await readRollout(file);
  const report = evaluateCollaboration(run(trace.events), 'local-fix');
  assert.equal(report.status, 'supported_checks_passed'); assert.equal(report.evidence_level, 'normalized_trace_checks');
  assert.equal(report.additional_model_calls, 0); assert.equal(report.semantic_quality, 'unverified');
  assert.equal(JSON.stringify(report).includes(SECRET), false);
  assert.equal(collaborationScenarios().length, 6);
});

test('evaluation CLI is read-only and parser errors do not include input text', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-eval-cli-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'report.json'); const bytes = JSON.stringify(run([event('verification.run')]));
  await writeFile(file, bytes); let output = '';
  const code = await runEvaluateCollaboration(['--report', file, '--scenario', 'local-fix'], { stdout: { write: text => { output += text; } } });
  assert.equal(code, 0); assert.equal(JSON.parse(output).status, 'supported_checks_passed');
  await writeFile(file, SECRET);
  await assert.rejects(runEvaluateCollaboration(['--report', file, '--scenario', 'local-fix']), error => error.message === 'Invalid normalized report JSON');
});

test('unknown role or absent normalized fact is not evidence of compliant routing', () => {
  const unknown = evaluateCollaboration(run([event('agent.spawn', { role: 'unknown' }), event('verification.run')]), 'local-adjustment');
  assert.equal(unknown.checks.find(c => c.name === 'forbidden_spawn_roles').status, 'unknown');
  const noFact = evaluateCollaboration(run([{ kind: 'tool', status: 'success' }]), 'local-fix');
  assert.equal(noFact.checks.find(c => c.name === 'spawn_budget').status, 'unknown');
});

async function cliFixture(t, report, scenario = 'local-fix') {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-eval-pilot-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'report.json');
  await writeFile(file, JSON.stringify(report));
  return { temp, file, args: ['--report', file, '--scenario', scenario] };
}
async function invoke(argv) {
  let stdout = '', stderr = '';
  const code = await runCommand('evaluate-collaboration', argv, {
    stdout: { write: text => { stdout += text; } },
    stderr: { write: text => { stderr += text; } },
  });
  return { code, stdout, stderr };
}

test('default JSON is unchanged and strict exits distinguish pass, fail and incomplete in both formats', async (t) => {
  const scenarios = [
    { report: run([event('verification.run')]), status: 'supported_checks_passed', defaultExit: 0, strictExit: 0 },
    { report: run([event('verification.run'), event('agent.spawn', { role: 'explorer' })]), status: 'supported_check_failed', defaultExit: 1, strictExit: 1 },
    { report: { ...run([]), coverage: { status: 'partial' } }, status: 'incomplete', defaultExit: 0, strictExit: 3 },
    { report: run([event('opaque')]), status: 'incomplete', defaultExit: 0, strictExit: 3 },
  ];
  for (const item of scenarios) {
    const { args } = await cliFixture(t, item.report);
    const before = evaluateCollaboration(item.report, 'local-fix');
    assert.deepEqual(JSON.parse((await invoke(args)).stdout), before);
    for (const format of ['json', 'md']) {
      for (const strict of [false, true]) {
        const result = await invoke([...args, '--format', format, ...(strict ? ['--fail-on-incomplete'] : [])]);
        assert.equal(result.code, strict ? item.strictExit : item.defaultExit);
        assert.equal(result.stderr, '');
        if (format === 'json') assert.deepEqual(JSON.parse(result.stdout), before);
        else {
          assert.ok(result.stdout.includes(item.status));
          assert.match(result.stdout, /Semantic quality: unverified/u);
          assert.match(result.stdout, /Human acceptance.*unverified/u);
          assert.match(result.stdout, /not full quality approval/u);
        }
      }
    }
  }
});

test('scenario without automatic checks stays incomplete and Markdown exposes unknown rather than a green badge', async (t) => {
  const noChecks = await cliFixture(t, run([]), 'public-contract-change');
  const result = await invoke([...noChecks.args, '--format', 'md', '--fail-on-incomplete']);
  assert.equal(result.code, 3);
  assert.match(result.stdout, /No automated checks/u);
  assert.match(result.stdout, /Unknown is not a pass/u);
  const partial = await cliFixture(t, { ...run([]), coverage: { status: 'partial' } });
  assert.match((await invoke([...partial.args, '--format', 'md'])).stdout, /\| unknown \|/u);
  const zero = await cliFixture(t, run([event('verification.run')]));
  assert.match((await invoke([...zero.args, '--format', 'md'])).stdout, /\| spawn_budget \| pass \| 0 \| 0 \|/u);
});

test('scenario lists support JSON and Markdown; help explains incomplete exit and malformed options exit 2', async () => {
  const list = await invoke(['--list']);
  assert.equal(list.code, 0); assert.equal(JSON.parse(list.stdout).length, 6);
  const markdown = await invoke(['--list', '--format', 'md', '--fail-on-incomplete']);
  assert.equal(markdown.code, 0);
  for (const scenario of collaborationScenarios()) assert.ok(markdown.stdout.includes(scenario.id));
  assert.match(markdown.stdout, /not an evaluation/u);
  const help = await invoke(['--help']);
  assert.equal(help.code, 0); assert.match(help.stdout, /3 incomplete with --fail-on-incomplete/u);
  assert.match(help.stdout, /0 supported action checks passed or incomplete/u);
  for (const argv of [['--list', '--format', 'html'], ['--format'], ['--fail-on-incomplete=true'], ['--scenario', 'local-fix']]) {
    const result = await invoke(argv);
    assert.equal(result.code, 2); assert.equal(result.stdout, '');
  }
});

test('Markdown remains read-only and never copies private report fields or invalid input', async (t) => {
  const report = { ...run([event('verification.run')]), private_dialogue: SECRET };
  report.events[0].private_output = SECRET;
  const fixture = await cliFixture(t, report);
  const before = await readFile(fixture.file);
  const listing = await readdir(fixture.temp);
  for (const format of ['json', 'md']) {
    const result = await invoke([...fixture.args, '--format', format]);
    assert.equal(result.code, 0);
    assert.equal((result.stdout + result.stderr).includes(SECRET), false);
  }
  assert.deepEqual(await readFile(fixture.file), before);
  assert.deepEqual(await readdir(fixture.temp), listing);
  await writeFile(fixture.file, SECRET);
  const invalid = await invoke([...fixture.args, '--format', 'md']);
  assert.equal(invalid.code, 1); assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr.trim(), 'Invalid normalized report JSON');
});

test('new output and exit options retain report symlink and size safety checks', async (t) => {
  const fixture = await cliFixture(t, run([]));
  const link = path.join(fixture.temp, 'link.json'); await symlink(fixture.file, link);
  const unsafe = await invoke(['--report', link, '--scenario', 'local-fix', '--format', 'md', '--fail-on-incomplete']);
  assert.equal(unsafe.code, 1); assert.equal(unsafe.stdout, '');
  assert.match(unsafe.stderr, /Symlink report refused/u);
  await writeFile(fixture.file, Buffer.alloc(8 * 1024 * 1024 + 1));
  const oversized = await invoke([...fixture.args, '--format', 'md']);
  assert.equal(oversized.code, 1); assert.equal(oversized.stdout, '');
  assert.match(oversized.stderr, /Invalid or oversized report file/u);
});
