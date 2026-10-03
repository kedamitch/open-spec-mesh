import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { aggregateUsage, reworkAnnotations } from '../../../lib/observation/usage.js';
import { sddArtifacts } from '../../../lib/observation/collect.js';
import { diagnose, groupRuns, markdown, summary } from '../../../lib/observation/diagnose.js';
import { runObserve } from '../../../lib/observation/cli.js';

const usage = (n, cached = 2) => ({ input_tokens: BigInt(n), cached_input_tokens: BigInt(cached), output_tokens: 3n });
const base = extra => ({ root_session: 'main', sessions: [], events: [], expectation: { mode: 'sdd', roles: [] },
  sdd: { graph: 'absent', tasks: [], events: [] }, coverage: { status: 'observed', issues: [] }, snapshots: [],
  project_key: 'one', collected_at: '2026-09-30T10:00:00Z', configuration_fingerprint: 'fixture', ...extra });

test('same session delta is counted once, conflicts are unknown, and incomplete total is not a bill', () => {
  const main = { id: 'm', role: 'main', usage: usage(10) }, child = { id: 'c', role: 'explorer', usage: usage(20) };
  const complete = aggregateUsage([main, main, child]);
  assert.equal(complete.sessions_observed, 2); assert.equal(complete.duplicate_session_records, 1);
  assert.equal(complete.usage_total.input_tokens, 30n); assert.equal(complete.monetary_cost.amount, null);
  assert.equal(complete.usage_by_role.find(r => r.role === 'main').usage_observed.input_tokens, 10n);
  const partial = aggregateUsage([main, { ...child, usage: null }]);
  assert.equal(partial.usage_observed.input_tokens, 10n); assert.equal(partial.usage_total, null);
  assert.deepEqual(partial.usage_coverage, { numerator: 1, denominator: 2 });
  const conflict = aggregateUsage([main, { ...main, usage: usage(11) }]);
  assert.equal(conflict.usage_total, null); assert.equal(conflict.usage_observed, null);
  assert.ok(conflict.usage_issues.includes('duplicate_usage_conflict'));
  assert.equal(aggregateUsage([main], { scopeComplete: false }).usage_total, null);
});

test('disjoint grouped slices can reuse a session and exact token arithmetic stays lossless', () => {
  const large = { input_tokens: 9007199254740993n, cached_input_tokens: 0n, output_tokens: 0n };
  const r = aggregateUsage([{ id: 'same', slice_id: 'a', role: 'main', usage: large }, { id: 'same', slice_id: 'b', role: 'main', usage: large }]);
  assert.equal(r.usage_total.input_tokens, 18014398509481986n);
  assert.equal(aggregateUsage([{ id: 'x', usage: usage(1, 2) }]).usage_total, null);
});

test('manual task inventory has no inferred state or zero-rework metric', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'osm-efficiency-')); t.after(() => rm(root, { recursive: true, force: true }));
  const id = 'CHG-20260930-efficiency', dir = path.join(root, 'docs/05-changes/C01-进行中', id);
  await mkdir(path.join(dir, 'C03-tasks/C03-01-work'), { recursive: true });
  await writeFile(path.join(dir, 'index.md'), '# index\n'); await writeFile(path.join(dir, 'C01-change.md'), '# contract\n');
  const sdd = await sddArtifacts(root, id);
  assert.equal(sdd.manual_tasks.length, 1); assert.equal(sdd.manual_tasks[0].state, null);
  const report = diagnose(base({ sdd, run_id: 'manual' }));
  assert.equal(report.metrics.tasks_observed, 1); assert.equal(report.metrics.tasks_currently_accepted, null);
  assert.equal(report.metrics.first_pass.denominator, null); assert.equal(report.metrics.direct_rework, null);
  assert.equal(report.metrics.causal_rework.count, null);
  assert.match(markdown(report), /不适用\/unknown/u); assert.match(summary([report]), /unknown \/ 不适用/u);
});

test('optional annotations are explicit, partial, deduplicated and never inferred from dialogue', () => {
  const mark = { id: 'rework-1', reason: 'handoff', source: 'operator_annotation' };
  const r = reworkAnnotations([mark, mark]); assert.equal(r.count, 1); assert.equal(r.complete, false);
  assert.equal(reworkAnnotations([{ ...mark, reason: 'assumption' }, mark]).count, null);
  assert.equal(reworkAnnotations().status, 'unknown');
  assert.throws(() => reworkAnnotations([{ ...mark, reason: 'raw secret text' }]), /Invalid/u);
  const run = diagnose(base({ annotations: { rework: [mark] } }));
  assert.equal(run.metrics.direct_rework, null); assert.equal(run.metrics.causal_rework.by_reason.handoff, 1);
});

test('grouped usage includes Main and child deltas and does not turn manual history into success', () => {
  const a = diagnose(base({ root_session: 'a', turn: '1', run_id: 'a', sessions: [{ id: 'a', role: 'main', usage: usage(10) }] }));
  const b = diagnose(base({ root_session: 'b', turn: '1', run_id: 'b', sessions: [{ id: 'b', role: 'worker', usage: usage(20) }] }));
  const group = groupRuns([a, b]);
  assert.equal(group.metrics.usage_total.input_tokens, 30n); assert.equal(group.metrics.first_pass.denominator, null);
  assert.equal(group.metrics.wall_seconds, null);
});

test('annotation CLI uses existing private store and preserves operator provenance', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-rework-cli-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project'), rules = path.join(temp, 'rules'), state = path.join(temp, 'state');
  await Promise.all([mkdir(project), mkdir(rules), mkdir(state, { mode: 0o700 })]);
  const db = path.join(state, 'obs.sqlite3'); let output = '', errors = '';
  const io = { stdout: { write: s => { output += s; } }, stderr: { write: s => { errors += s; } } };
  assert.equal(await runObserve(['--host', 'opencode', '--db', db, 'collect', '--root', project, '--rules-root', rules, '--run', 'marked', '--rework-mark', 'fix-1:integration'], io), 0, errors);
  output = ''; assert.equal(await runObserve(['--host', 'opencode', '--db', db, 'report', '--run', 'marked', '--format', 'json'], io), 0, errors);
  const report = JSON.parse(output); assert.equal(report.metrics.causal_rework.count, 1);
  assert.equal(report.annotations.rework[0].source, 'operator_annotation');
  assert.equal(await runObserve(['--db', db, 'summary', '--rework-mark', 'bad:handoff'], io), 1);
});

test('legacy changes with identical task IDs keep independent rework histories when grouped', () => {
  const old = (id, direct) => ({ graph: 'present', change_id: id, tasks: [{ id: 'C03-01', state: 'accepted', attempt: 1 }], events: [
    { task_id: 'C03-01', state: 'submitted' }, ...(direct ? [{ task_id: 'C03-01', state: 'submitted', action: 'rework', direct: true }] : []),
  ] });
  const a = diagnose(base({ root_session: 'a', turn: '1', run_id: 'a', sdd: old('CHG-A', false) }));
  const b = diagnose(base({ root_session: 'b', turn: '1', run_id: 'b', sdd: old('CHG-B', true) }));
  const group = groupRuns([a, b]); assert.deepEqual(group.metrics.first_pass, { numerator: 1, denominator: 2 });
});

test('missing session IDs and invalid merged cached counts cannot manufacture a complete total', () => {
  const missing = aggregateUsage([{ usage: usage(10) }, { id: 'unknown-0', usage: usage(20) }]);
  assert.equal(missing.sessions_observed, 2); assert.equal(missing.usage_observed.input_tokens, 30n); assert.equal(missing.usage_total, null);
  const merged = aggregateUsage([{ id: 'a', usage: { input_tokens: 1n } }, { id: 'a', usage: { cached_input_tokens: 2n, output_tokens: 0n } }]);
  assert.equal(merged.usage_total, null); assert.ok(merged.usage_issues.includes('invalid_usage_combination'));
});
