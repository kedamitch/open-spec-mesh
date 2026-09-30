import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BEGIN, END, HOST_MANIFEST, MANIFEST, PACKAGE_ID, blobHash, catalog, cleanAgents, hostManifestText, retirement,
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

test('edited legacy rules remain untouched and produce a migration warning', () => {
  const old = '# Old package rules\n\n[flow](sdd-plan/references/policy.md)\n';
  const edited = old.replace('Old package', 'User edited');
  const result = cleanAgents(edited, '# New package rules\n\nCurrent.\n', new Set([blobHash(Buffer.from(old))]));
  assert.equal(result.unmarked, 0);
  assert.equal(result.text.startsWith(edited), true);
  assert.ok(result.warnings.length > 0);
});

test('legacy rules match installed skill links and CRLF fingerprints', () => {
  const old = '# Old package rules\n\n[flow](sdd-plan/references/policy.md)\n';
  const current = '# New package rules\n\nCurrent.\n';
  const installed = old.replace('](sdd-plan/', '](skills/sdd-plan/').replaceAll('\n', '\r\n').replace(/\r\n$/u, '');
  const result = cleanAgents(installed, current, new Set([blobHash(Buffer.from(old))]));
  assert.equal(result.unmarked, 1);
  assert.equal(result.text.includes('[flow](skills/sdd-plan/'), false);
  assert.equal(result.text.includes(current), true);
});

test('example fences hide legacy and managed marker text from migration parsing', () => {
  const old = '# Old package rules\n\n[flow](sdd-plan/references/policy.md)\n';
  const example = `\`\`\`\`markdown\n${old}${BEGIN}\nexample\n${END}\n\`\`\`\`\n`;
  const result = cleanAgents(example, '# New package rules\n\nCurrent.\n', new Set([blobHash(Buffer.from(old))]));
  assert.equal(result.marked, 0);
  assert.equal(result.unmarked, 0);
  assert.equal(result.text.startsWith(example), true);
});

test('malformed visible managed markers fail closed', () => {
  const malformed = [BEGIN, END, `${BEGIN}\n${BEGIN}\n${END}\n`];
  for (const text of malformed) assert.throws(() => cleanAgents(text, '# current\n'));
});

test('catalog retains canonical AGENTS.md blobs from real Git history', (t) => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'osm-migration-git-'));
  t.after(() => rmSync(source, { recursive: true, force: true }));
  mkdirSync(path.join(source, 'scripts'));
  writeFileSync(path.join(source, 'scripts/install-legacy.json'), JSON.stringify({ agents_md: [] }));
  const historical = '# Historical canonical instructions\n';
  const current = '# Current canonical instructions\n';
  writeFileSync(path.join(source, 'AGENTS.md'), historical);
  execFileSync('git', ['init', source], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Open Spec Mesh tests'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'config', 'user.email', 'tests@example.invalid'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'add', 'AGENTS.md', 'scripts/install-legacy.json'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'commit', '-m', 'historical rules'], { stdio: 'ignore' });
  writeFileSync(path.join(source, 'AGENTS.md'), current);
  execFileSync('git', ['-C', source, 'add', 'AGENTS.md'], { stdio: 'ignore' });
  execFileSync('git', ['-C', source, 'commit', '-m', 'current rules'], { stdio: 'ignore' });

  const hashes = catalog(source);
  assert.equal(hashes.has(blobHash(historical)), true);
  assert.equal(hashes.has(blobHash(current)), true);
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

test('retirement preserves a user-owned personal agents README', (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'osm-personal-readme-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'agents'));
  const readme = '# My agents\nKeep my personal workflows.\n';
  writeFileSync(path.join(home, 'agents/README.md'), readme);
  const plan = retirement(home, {}, { skills: [], roles: {} }, ['sdd-do'], ['worker']);
  assert.equal(plan.paths.includes('agents/README.md'), false);
  assert.equal(readFileSync(path.join(home, 'agents/README.md'), 'utf8'), readme);
});
