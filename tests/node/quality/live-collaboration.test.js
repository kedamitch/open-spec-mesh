import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveArgs, extractLiveEvents } from '../../../scripts/verify_codex_live.js';

test('real inference requires an explicit invocation and private evidence target', () => {
  assert.deepEqual(parseLiveArgs(['--help']), { help: true });
  for (const argv of [[], ['--run'], ['--output', '/var/tmp/none'], ['--run', '--output'], ['--run', '--output', '/var/tmp/none', '--model', 'other']]) assert.throws(() => parseLiveArgs(argv));
  const parsed = parseLiveArgs(['--run', '--output', '/var/tmp/none']);
  assert.equal(parsed.run, true); assert.equal(parsed.output, '/var/tmp/none');
});

test('CLI metadata extraction does not retain dialogue, credentials or child-inclusive cost claims', () => {
  const secret = 'sk-SYNTHETIC-DO-NOT-RETAIN';
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const stdout = [
    JSON.stringify({ type: 'thread.started', thread_id: id }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: secret } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 5, api_key: secret } }),
  ].join('\n');
  const summary = extractLiveEvents(stdout);
  assert.equal(summary.thread, id); assert.deepEqual(summary.usage, { input_tokens: 100, cached_input_tokens: 50, output_tokens: 5 });
  assert.equal(JSON.stringify(summary).includes(secret), false);
  assert.equal(summary.usage_scope, 'root_cli_only_child_usage_not_included');
  assert.equal(extractLiveEvents('{"type":"turn.completed","usage":{"input_tokens":-1}}').usage, null);
});

test('reanalysis is a distinct explicit no-model action and cannot be combined with paid execution', () => {
  const args = parseLiveArgs(['--reanalyze', '--output', '/var/tmp/existing']);
  assert.equal(args.reanalyze, true); assert.equal(args.run, false);
  assert.throws(() => parseLiveArgs(['--run', '--reanalyze', '--output', '/var/tmp/any']));
});
