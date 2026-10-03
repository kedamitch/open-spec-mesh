#!/usr/bin/env node
// CI release artifact preparation and independent public-registry verification.
// No login, token configuration, Git writes, or upload is performed here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY = 'https://registry.npmjs.org/';
export const NAME = 'open-spec-mesh';
// Publication can become visible just after the old two-minute window. Bound
// scheduled waits to five minutes while polling less often; never retry an upload.
export const REGISTRY_POLL_ATTEMPTS = 21;
export const REGISTRY_POLL_DELAY_MS = 15_000;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024, shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}); ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export function validateVersion(version) {
  // Releases deliberately use stable, explicitly requested versions only.
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u, 'Expected an exact stable version');
  return version;
}

export function validateSource(root, version) {
  validateVersion(version);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  assert.equal(pkg.name, NAME);
  assert.equal(pkg.version, version, 'Requested version must match committed source');
  assert.equal(pkg.repository.url, 'git+https://github.com/kedamitch/open-spec-mesh.git');
  const lock = fs.readFileSync(path.join(root, 'package-lock.json'));
  assert.deepEqual(lock, fs.readFileSync(path.join(root, 'npm-shrinkwrap.json')), 'Lockfiles must be byte-identical');
  const metadata = JSON.parse(lock);
  assert.equal(metadata.version, version);
  assert.equal(metadata.packages[''].version, version);
}

export function fingerprint(bytes) {
  return { integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex') };
}

export function validatePack(info, root, version) {
  assert.equal(info.name, NAME);
  assert.equal(info.version, version);
  assert.equal(info.filename, `${NAME}-${version}.tgz`);
  assert.ok(info.files.some(({ path: name }) => name === 'npm-shrinkwrap.json'));
  for (const { path: name } of info.files) {
    assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'), 'Unsafe package path');
    assert.ok(!/(^|\/)(?:node_modules|\.git|\.codex|\.agents|\.aws|\.npmrc|auth\.json|\.env(?:\..*)?|id_rsa|id_ed25519)(?:\/|$)|\.(?:py|zip|db|sqlite|sqlite3)$/iu.test(name),
      `Sensitive or retired file in artifact: ${name}`);
    assert.ok(!/^sdd-(?:change|requirements)\/(?:scripts\/|SKILL\.md$)/u.test(name), `Retired skill entry: ${name}`);
    const bytes = fs.readFileSync(path.join(root, name));
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bnpm_[A-Za-z0-9]{36,}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b/u.test(bytes.toString('utf8')),
      `Potential credential in artifact: ${name}`);
  }
}

export async function registryMetadata(fetcher = fetch) {
  const response = await fetcher(`${REGISTRY}${NAME}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `Public registry lookup failed (${response.status}); do not infer version absence`);
  const metadata = await response.json();
  assert.equal(metadata.name, NAME);
  assert.ok(metadata.versions && typeof metadata.versions === 'object', 'Malformed registry metadata');
  return metadata;
}

export function assertUnpublished(metadata, version) {
  assert.ok(!Object.hasOwn(metadata.versions, validateVersion(version)), `${NAME}@${version} already exists; never republish`);
}

export function assertPublished(metadata, info) {
  const release = metadata.versions[info.version];
  assert.ok(release, `${NAME}@${info.version} is not publicly available`);
  assert.equal(metadata['dist-tags']?.latest, info.version, 'latest does not match the requested release');
  assert.equal(release.dist.integrity, info.integrity);
  assert.equal(release.dist.shasum, info.shasum);
}

// Retry only public reads for registry propagation; never retry npm publish.
export async function waitForPublished(info, { fetcher = fetch, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = REGISTRY_POLL_ATTEMPTS } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const metadata = await registryMetadata(fetcher);
    const release = metadata.versions[info.version];
    if (release) {
      // A published version with different bytes is a hard failure, not propagation.
      assert.equal(release.dist.integrity, info.integrity);
      assert.equal(release.dist.shasum, info.shasum);
      if (metadata['dist-tags']?.latest === info.version) return metadata;
    }
    if (index + 1 < attempts) await pause(REGISTRY_POLL_DELAY_MS);
  }
  throw new Error(    `Public registry did not expose the requested version/latest within the verification window; inspect before any upload retry`);
}

function readArtifact(directory, version) {
  validateVersion(version);
  const info = JSON.parse(fs.readFileSync(path.join(directory, 'release-artifact.json')));
  assert.equal(info.name, NAME);
  assert.equal(info.version, version);
  assert.equal(info.filename, `${NAME}-${version}.tgz`);
  const tarball = path.resolve(directory, info.filename);
  assert.deepEqual(fingerprint(fs.readFileSync(tarball)), { integrity: info.integrity, shasum: info.shasum });
  if (process.env.GITHUB_SHA) assert.equal(info.commit, process.env.GITHUB_SHA, 'Artifact must belong to this workflow commit');
  return { info, tarball };
}

export function isolatedConsumerEnvironment(temp, parent = process.env) {
  const home = path.join(temp, 'home');
  fs.mkdirSync(home);
  const userconfig = path.join(temp, 'user.npmrc');
  const globalconfig = path.join(temp, 'global.npmrc');
  fs.writeFileSync(userconfig, '', { mode: 0o600 });
  fs.writeFileSync(globalconfig, '', { mode: 0o600 });
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (/^(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_ID_TOKEN|ACTIONS_ID_TOKEN_REQUEST_.*|NPM_CONFIG_.*(?:AUTH|TOKEN).*)$/iu.test(key)) delete env[key];
  }
  return { ...env, HOME: home, CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_STATE_HOME: path.join(home, '.state'),
    OPEN_SPEC_MESH_STATE_HOME: path.join(home, '.state', NAME),
    NPM_CONFIG_USERCONFIG: userconfig, npm_config_userconfig: userconfig,
    NPM_CONFIG_GLOBALCONFIG: globalconfig, npm_config_globalconfig: globalconfig,
    NPM_CONFIG_REGISTRY: REGISTRY, npm_config_registry: REGISTRY,
    NPM_CONFIG_CACHE: path.join(temp, 'cache'), npm_config_cache: path.join(temp, 'cache') };
}

export function consumerSmoke(spec, version) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-release-consumer-'));
  try {
    const prefix = path.join(temp, 'prefix');
    const env = isolatedConsumerEnvironment(temp);
    const options = { cwd: temp, env };
    run('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund',
      `--registry=${REGISTRY}`, spec], options);
    const cli = path.join(prefix, 'bin', NAME);
    assert.equal(run(cli, ['--version'], options), version);
    assert.equal(run(path.join(prefix, 'bin/osm'), ['--version'], options), version);
    run(cli, ['--help'], options);
    run(cli, ['install', '--host', 'codex', '--skip-tools'], options);
    const managed = JSON.parse(fs.readFileSync(path.join(env.CODEX_HOME, '.open-spec-mesh-managed.json')));
    for (const skill of ['sdd-req', 'sdd-design', 'sdd-plan', 'sdd-release']) assert.ok(managed.skills.includes(skill));
    for (const skill of ['sdd-change', 'sdd-requirements']) assert.ok(!managed.skills.includes(skill));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export async function main([command, version, directory]) {
  validateVersion(version ?? '');
  assert.ok(directory, 'Usage: node scripts/npm_release.js prepare|check|verify VERSION DIRECTORY');
  directory = path.resolve(directory);
  if (command === 'prepare') {
    validateSource(ROOT, version);
    assert.equal(run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT }), '',
      'CI release requires a clean committed source tree; do not publish an uncommitted workspace');
    assertUnpublished(await registryMetadata(), version);
    fs.mkdirSync(directory, { recursive: true });
    assert.ok(!fs.existsSync(path.join(directory, 'release-artifact.json')), 'Use a fresh artifact directory');
    const [info] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: ROOT }));
    validatePack(info, ROOT, version);
    assert.deepEqual(fingerprint(fs.readFileSync(path.join(directory, info.filename))), { integrity: info.integrity, shasum: info.shasum });
    consumerSmoke(path.join(directory, info.filename), version);
    const record = { name: NAME, version, filename: info.filename, integrity: info.integrity, shasum: info.shasum,
      commit: process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD'], { cwd: ROOT }), files: info.files.length,
      localConsumer: 'passed' };
    fs.writeFileSync(path.join(directory, 'release-artifact.json'), `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify(record, null, 2));
  } else if (command === 'check' || command === 'verify') {
    const { info } = readArtifact(directory, version);
    if (command === 'check') assertUnpublished(await registryMetadata(), version);
    else {
      assertPublished(await waitForPublished(info), info);
      consumerSmoke(`${NAME}@${version}`, version);
      console.log(`${NAME}@${version}: public registry integrity, latest, and fresh npm consumer passed`);
    }
  } else throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
