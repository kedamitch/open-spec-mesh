import assert from 'node:assert/strict';
import test from 'node:test';
import { DELETE, parseToml, setTomlValue } from '../../../lib/installation/toml.js';

test('managed TOML edits preserve unrelated statement bytes and parse complex TOML values', () => {
  const original = [
    '# user bytes stay byte-for-byte',
    'quoted = "# not a comment" # trailing comment',
    'special = { dotted.key = "value", nested = [1, 2, 3] }',
    'when = 2026-09-28T10:20:30Z',
    'limit = 9_223_372_036_854_775_807',
    'amount = -0.0',
    'nan_value = nan',
    'prompt = """\n[mcp_servers.fake]\nthis is prompt text, not a table\n"""',
    '',
    '[mcp_servers.fake]',
    'command = "custom-provider"',
    'args = ["--model", "user/model"]',
    '',
    '[mcp_servers.managed]',
    'command = "old-command" # update only this statement',
    '',
  ].join('\n');
  const updated = setTomlValue(original, ['mcp_servers', 'managed', 'command'], 'new-command');
  const expected = original.replace('command = \"old-command\" # update only this statement', 'command = \"new-command\"');
  assert.equal(updated, expected);
  const parsed = parseToml(updated);
  assert.equal(parsed.mcp_servers.managed.command, 'new-command');
  assert.equal(parsed.mcp_servers.fake.command, 'custom-provider');
  assert.equal(parsed.mcp_servers.fake.args[1], 'user/model');
  assert.equal(parsed.special.nested.length, 3);
  assert.equal(Object.is(parsed.amount, -0), true);
  assert.equal(Number.isNaN(parsed.nan_value), true);
  assert.equal(parsed.prompt.includes('[mcp_servers.fake]'), true);
  assert.equal(typeof parsed.limit, 'bigint');
});

test('deleting a managed table leaves custom sibling servers intact', () => {
  const original = '[mcp_servers]\ncustom = { command = "mine", args = ["keep"] }\nmanaged = { command = "ours" }\n';
  const updated = setTomlValue(original, ['mcp_servers', 'managed'], DELETE);
  assert.deepEqual(parseToml(updated).mcp_servers.custom, { command: 'mine', args: ['keep'] });
  assert.equal(Object.hasOwn(parseToml(updated).mcp_servers, 'managed'), false);
});

test('ambiguous and malformed edits fail without changing the input string', () => {
  const malformed = '[mcp_servers\ncommand = "bad"';
  assert.throws(() => setTomlValue(malformed, ['mcp_servers', 'laya', 'command'], 'node'));
  assert.equal(malformed, '[mcp_servers\ncommand = "bad"');
  const scalarParent = 'mcp_servers = 42\n';
  assert.throws(() => setTomlValue(scalarParent, ['mcp_servers', 'laya'], {}));
});
