import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertPublished, assertUnpublished, fingerprint, registryMetadata, validatePack, validateSource, validateVersion, waitForPublished } from '../../../scripts/npm_release.js';

const info = { name: 'open-spec-mesh', version: '0.0.2', filename: 'open-spec-mesh-0.0.2.tgz', ...fingerprint(Buffer.from('release')) };
test('versions are exact stable requests, not ranges or shell payloads', () => {
  assert.equal(validateVersion('0.0.2'), '0.0.2');
  for (const bad of ['', 'latest', 'v0.0.2', '0.0.2;echo x', '../0.0.2', '00.0.2', '0.0.2-beta']) assert.throws(() => validateVersion(bad));
});
test('committed version, repository and identical locks are required', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-release-test-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: info.name, version: info.version,
      repository: { url: 'git+https://github.com/kedamitch/open-spec-mesh.git' } }));
    const lock = JSON.stringify({ version: info.version, packages: { '': { version: info.version } } });
    for (const name of ['package-lock.json', 'npm-shrinkwrap.json']) fs.writeFileSync(path.join(root, name), lock);
    validateSource(root, info.version);
    assert.throws(() => validateSource(root, '0.0.3'));
    fs.appendFileSync(path.join(root, 'npm-shrinkwrap.json'), '\n');
    assert.throws(() => validateSource(root, info.version), /byte-identical/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('existing versions cannot be republished and network/auth errors are not absence', async () => {
  assertUnpublished({ versions: { '0.0.1': {} } }, info.version);
  assert.throws(() => assertUnpublished({ versions: { [info.version]: {} } }, info.version), /already exists/u);
  for (const status of [401, 403, 404, 500]) await assert.rejects(registryMetadata(async () => ({ status })), /lookup failed/u);
  await assert.rejects(registryMetadata(async () => ({ status: 200, json: async () => ({ name: info.name }) })), /Malformed/u);
  await assert.rejects(registryMetadata(async () => { throw new Error('network down'); }), /network down/u);
});
test('post-publication requires version, tag and both byte fingerprints', () => {
  const metadata = { name: info.name, versions: { [info.version]: { dist: { integrity: info.integrity, shasum: info.shasum } } }, 'dist-tags': { latest: info.version } };
  assertPublished(metadata, info);
  assert.throws(() => assertPublished({ ...metadata, versions: {} }, info), /not publicly/u);
  assert.throws(() => assertPublished({ ...metadata, 'dist-tags': { latest: '0.0.1' } }, info));
  for (const key of ['integrity', 'shasum']) {
    const changed = structuredClone(metadata); changed.versions[info.version].dist[key] = 'tampered';
    assert.throws(() => assertPublished(changed, info));
  }
});
test('pack audit rejects secrets, old executables and unsafe paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-release-pack-test-'));
  try {
    fs.writeFileSync(path.join(root, 'npm-shrinkwrap.json'), '{}');
    const packed = { ...info, files: [{ path: 'npm-shrinkwrap.json' }] };
    validatePack(packed, root, info.version);
    for (const name of ['.npmrc', 'auth.json', '.env.prod', '.codex/config.toml', 'node_modules/a.js', '../outside', 'old.py', 'diagnosis.zip', 'sdd-change/scripts/old.js', 'sdd-requirements/SKILL.md']) {
      assert.throws(() => validatePack({ ...packed, files: [...packed.files, { path: name }] }, root, info.version));
    }
    fs.writeFileSync(path.join(root, 'credential.md'), `npm_${'a'.repeat(40)}`);
    assert.throws(() => validatePack({ ...packed, files: [...packed.files, { path: 'credential.md' }] }, root, info.version), /Potential credential/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('workflow is manual, main-only, no long-lived secret and separates OIDC upload from preparation', () => {
  const yaml = fs.readFileSync(new URL('../../../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
  assert.match(yaml, /workflow_dispatch:/u);
  assert.doesNotMatch(yaml, /\b(?:push|pull_request|schedule|workflow_call):|secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/u);
  assert.match(yaml, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(yaml, /cancel-in-progress: false/u);
  const [prepare, publish] = yaml.split('\n  publish:');
  assert.doesNotMatch(prepare, /id-token: write/u);
  assert.match(publish, /needs: prepare/u);
  assert.match(publish, /environment: npm/u);
  assert.match(publish, /id-token: write/u);
  assert.match(publish, /npm publish .*\.tgz.*--ignore-scripts/u);
  assert.match(publish, /steps\.publish\.outcome != 'skipped'/u);
});

test('verification retries only propagation reads, never mismatched bytes or request errors', async () => {
  let reads = 0;
  const published = { name: info.name, versions: { [info.version]: { dist: info } }, 'dist-tags': { latest: info.version } };
  const fetcher = async () => ({ status: 200, json: async () => ++reads === 1 ? { name: info.name, versions: {} } : published });
  assert.deepEqual(await waitForPublished(info, { fetcher, pause: async () => {}, attempts: 2 }), published);
  assert.equal(reads, 2);
  reads = 0;
  await assert.rejects(waitForPublished({ ...info, integrity: 'bad' }, { fetcher: async () => { reads++; return { status: 200, json: async () => published }; }, pause: async () => {} }));
  assert.equal(reads, 1);
  await assert.rejects(waitForPublished(info, { fetcher: async () => ({ status: 401 }), pause: async () => {} }), /lookup failed/u);
  await assert.rejects(waitForPublished(info, { fetcher: async () => ({ status: 200, json: async () => ({ name: info.name, versions: {} }) }), pause: async () => {}, attempts: 2 }), /verification window/u);
});
