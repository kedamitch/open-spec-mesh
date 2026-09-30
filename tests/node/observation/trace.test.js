import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commandFact, outputStatus, policySignal, readRollout } from '../../../lib/observation/trace.js';
import { baseRows, endRow, SECRET, writeRows, envelope } from './helpers.js';

test('trace reduces native calls and never retains raw arguments, output, cwd, or instructions', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-trace-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'rollout.jsonl');
  const rows = [
    ...baseRows('root', { cwd: '/private/project', base_instructions: SECRET }),
    envelope('response_item', { type: 'function_call', call_id: 'spawn-1', namespace: 'agents', name: 'agents.spawn_agent', arguments: JSON.stringify({ agent_type: 'explorer', prompt: SECRET, fork_turns: 'none' }) }, 3),
    envelope('response_item', { type: 'function_call_output', call_id: 'spawn-1', output: JSON.stringify({ agent_id: 'child-1', private: SECRET }) }, 4),
    envelope('response_item', { type: 'function_call', call_id: 'exec-1', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat /private/file' }) }, 5),
    envelope('response_item', { type: 'function_call_output', call_id: 'exec-1', output: JSON.stringify({ exit_code: 0, text: SECRET }) }, 6),
    endRow(),
  ];
  await writeRows(file, rows);
  const trace = await readRollout(file);
  assert.equal(trace.id, 'root');
  assert.equal(trace.events.find((event) => event.call_id === 'spawn-1').fact.kind, 'agent.spawn');
  assert.equal(trace.events.find((event) => event.call_id === 'spawn-1').status, 'success');
  assert.equal(trace.events.find((event) => event.call_id === 'exec-1').status, 'success');
  assert.equal(JSON.stringify(trace).includes(SECRET), false);
  assert.equal(JSON.stringify(trace).includes('/private/project'), false);
});

test('lossless cumulative usage and malformed lines remain distinguishable', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-trace-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'rollout.jsonl');
  const rows = [
    ...baseRows(),
    envelope('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 900719925474099312345n.toString(), output_tokens: 7 } } }, 3),
    { type: 'not-json', payload: 'ignored' },
    endRow(),
  ];
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\nnot-json\n`);
  const trace = await readRollout(file);
  assert.equal(trace.events.find((event) => event.kind === 'usage.total').usage.input_tokens, 900719925474099312345n);
  assert.ok(trace.issues.includes('invalid_or_partial_json'));
});

test('unsafe paths, command parsing, status, and policy parsing are conservative', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'osm-trace-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const real = path.join(temp, 'real.jsonl');
  await writeRows(real, [...baseRows(), endRow()]);
  const link = path.join(temp, 'link.jsonl'); await symlink(real, link);
  await assert.rejects(readRollout(link), /non-symlink/);
  assert.equal(commandFact('python3 -c "import os"').kind, 'opaque');
  assert.equal(commandFact('python3 sdd-change/scripts/new_change.py x && echo y').kind, 'opaque');
  assert.equal(commandFact(['cat', '/x/.codex/skills/sdd-do/SKILL.md']).kind, 'skill.read');
  assert.deepEqual(outputStatus('{"exit_code":0}')[0], 'success');
  assert.equal(policySignal('| Explorer / Librarian | 已批准 Complex 需要独立证据 |'), 'explorer_requires_complex');
  assert.equal(policySignal('```md\n| Explorer / Librarian | 已批准 Complex |\n```'), null);
});


test('new stage skill reads are classified separately while historical sdd-change traces remain readable', () => {
  for (const skill of ['sdd-req', 'sdd-requirements', 'sdd-design', 'sdd-plan', 'sdd-change']) {
    assert.deepEqual(commandFact(['cat', '/installed/skills/' + skill + '/SKILL.md']), { kind: 'skill.read', skills: [skill] });
  }
});
