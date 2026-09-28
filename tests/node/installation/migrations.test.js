import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BEGIN, END, HOST_MANIFEST, MANIFEST, PACKAGE_ID, cleanAgents, hostManifestText,
  readHostManifest, readManifest,
} from '../../../lib/installation/migrations.js';

test('managed AGENTS markers replace only their block and retain exact user content', () => {
  const userPrefix = '# Local policy\r\nDo not rewrite this byte sequence.\r\n\r\n';
  const userSuffix = '\r\n# More local rules\r\nKeep.\r\n';
  const original = `${userPrefix}${BEGIN}\r\nold generated content\r\n${END}\r\n${userSuffix}`;
  const managed = '# Shared policy\nPlatform command: open-spec-mesh\n';
  const result = cleanAgents(original, managed);
  assert.equal(result.marked, 1);
  assert.equal(result.text.startsWith(userPrefix), true);
  assert.equal(result.text.endsWith(userSuffix), true);
  assert.equal(result.text.includes('old generated content'), false);
  assert.equal(result.text.includes(managed), true);
});

test('unmarked canonical history is migrated, while unrelated prose is preserved', () => {
  const local = '# My local title\nKeep this text.\n\n';
  const oldBlock = '# Open Spec Mesh\nOld canonical managed instructions.\n';
  const result = cleanAgents(`${local}${oldBlock}`, oldBlock);
  assert.equal(result.unmarked, 1);
  assert.equal(result.text.startsWith(local), true);
  assert.equal(result.text.includes('Old canonical managed instructions.'), true);
  assert.equal(result.text.includes(`${BEGIN}\n\n${oldBlock}`), true);
});

test('legacy/current manifest formats merge and reject damaged or unsafe ownership', (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'osm-manifest-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(path.join(home, '.open-spec-mesh.install.json'), JSON.stringify({
    package: PACKAGE_ID, schema_version: 1, skills: ['legacy-skill'], roles: { implementer: 'agents/implementer.toml' },
  }));
  writeFileSync(path.join(home, MANIFEST), JSON.stringify({ schema: 1, package: PACKAGE_ID, skills: ['sdd-do'], roles: ['worker'] }));
  const data = readManifest(home);
  assert.deepEqual(data.skills, ['legacy-skill', 'sdd-do']);
  assert.equal(data.roles.implementer, 'agents/implementer.toml');
  assert.equal(data.roles.worker, 'agents/worker.toml');
  writeFileSync(path.join(home, MANIFEST), JSON.stringify({ schema: 1, package: PACKAGE_ID, skills: ['../escape'], roles: ['worker'] }));
  assert.throws(() => readManifest(home), /Unsafe paths/);
});

test('host manifest binds host and rejects traversal paths', (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'osm-host-manifest-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'open-spec-mesh'));
  const fixture = new URL('../../fixtures/migration/installation/legacy-managed-host.json', import.meta.url);
  writeFileSync(path.join(home, HOST_MANIFEST), readFileSync(fixture));
  assert.equal([...readHostManifest(home, 'codex')].includes('mcp/laya_http_mcp.js'), true);
  writeFileSync(path.join(home, HOST_MANIFEST), hostManifestText('claude', new Set(['open-spec-mesh/runtime', 'skills/sdd-do'])));
  assert.deepEqual([...readHostManifest(home, 'claude')].sort(), ['open-spec-mesh/runtime', 'skills/sdd-do']);
  assert.throws(() => readHostManifest(home, 'codex'), /Unknown host install manifest/);
  writeFileSync(path.join(home, HOST_MANIFEST), JSON.stringify({ schema: 1, package: PACKAGE_ID, host: 'claude', paths: ['../escape'] }));
  assert.throws(() => readHostManifest(home, 'claude'), /Unsafe paths/);
});
