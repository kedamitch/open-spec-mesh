import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { legacyJson, parseLosslessJson, pythonFloat } from '../../../lib/runtime/compat-json.js';
import { validateGraph } from '../../../lib/runtime/graph-schema.js';
import { splitContract, visibleLines } from '../../../lib/documents/markdown.js';

const fixturePath = path.resolve('tests/fixtures/migration/document-tooling/compat-vectors.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function optionsFromFixture(options) {
  return {
    ensureAscii: options.ensure_ascii,
    sortKeys: options.sort_keys,
    separators: options.separators,
    indent: options.indent,
  };
}

test('Python serialization goldens preserve code points, numeric kinds and hashes', () => {
  for (const vector of fixture.vectors) {
    const input = vector.input ?? fixture.input;
    const encoded = legacyJson(parseLosslessJson(input), optionsFromFixture(vector.options));
    assert.equal(encoded, vector.expected, vector.name);
    assert.equal(createHash('sha256').update(encoded, 'utf8').digest('hex'), vector.sha256, vector.name);
  }
  assert.equal(legacyJson(pythonFloat(1)), '1.0');
  assert.equal(legacyJson(pythonFloat(-0)), '-0.0');
  for (const vector of fixture.float_goldens.cases) assert.equal(legacyJson(parseLosslessJson(vector.input)), vector.expected, vector.input);
  const numericKeys = parseLosslessJson('{\"2\":\"two\",\"1\":\"one\",\"name\":\"n\"}');
  assert.equal(legacyJson(numericKeys, { ensureAscii: false, separators: [',', ':'] }), '{\"2\":\"two\",\"1\":\"one\",\"name\":\"n\"}');
});

test('Python-compatible text reads normalize universal newlines and rstrip whitespace', async () => {
  const { decodeUtf8Compat, pythonRstrip } = await import('../../../lib/runtime/text.js');
  assert.equal(decodeUtf8Compat(Buffer.from(fixture.text.input, 'utf8')), fixture.text.universal_newline);
  assert.equal(pythonRstrip(fixture.text.universal_newline), fixture.text.rstrip);
});

test('lossless JSON safely retains prototype-named keys and rejects duplicate graph keys', () => {
  const parsed = parseLosslessJson('{"__proto__":{"polluted":true},"constructor":"kept"}');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(Object.prototype.polluted, undefined);
  assert.throws(() => parseLosslessJson('{"tasks":[],"tasks":[]}', { rejectDuplicateKeys: true }), /Duplicate JSON field/);
});

test('graph schema validates planned task shape, dependencies, fields and cycles without transitions', () => {
  const valid = { tasks: [
    { id: 'C03-01', depends_on: [], state: 'planned', history: [] },
    { id: 'C03-02', depends_on: ['C03-01'], state: 'planned', history: [] },
  ] };
  assert.equal(validateGraph(valid), valid);
  assert.throws(() => validateGraph({ tasks: [{ ...valid.tasks[0], acceptance: true }] }), /Invalid task fields/);
  assert.throws(() => validateGraph({ tasks: [{ id: 'A', depends_on: ['B'], state: 'planned' }] }), /unknown or self dependency/);
  assert.throws(() => validateGraph({ tasks: [
    { id: 'A', depends_on: ['B'], state: 'planned' },
    { id: 'B', depends_on: ['A'], state: 'planned' },
  ] }), /Dependency cycle/);
  assert.doesNotThrow(() => validateGraph({ tasks: [] }));
});

test('Markdown visible lines ignore examples/comments and split only a final evidence region', () => {
  const text = [
    '# Contract', '```md', '<!-- SDD:EVIDENCE:BEGIN -->', '## not live', '```',
    '<!-- hidden <!-- SDD:EVIDENCE:BEGIN --> -->', 'body', '<!-- SDD:EVIDENCE:BEGIN -->',
    '## 验证结果', 'passed', '## 最终结论', '通过', '<!-- SDD:EVIDENCE:END -->', '',
  ].join('\n');
  const visible = visibleLines(text).map(([, line]) => line);
  assert.equal(visible.filter((line) => line === '<!-- SDD:EVIDENCE:BEGIN -->').length, 1);
  const [stable, evidence] = splitContract(text);
  assert.match(stable, /# Contract/u);
  assert.match(evidence, /## 最终结论/u);
  assert.throws(() => splitContract(text.replace('## 最终结论', '## Hidden requirement\nNew requirement\n\n## 最终结论')), /only ## 验证结果 and ## 最终结论/u);
  assert.throws(() => visibleLines('```\nunfinished'), /Unclosed Markdown/);
});
