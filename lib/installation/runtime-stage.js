import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ID, RUNTIME_MARKER } from './migrations.js';
import { researchInstallEnv, resolveExecutable, safePath, safeTree } from './tools.js';
import { FORWARDED_ENV } from '../systemone/contracts.js';

const REQUIRED_PACKAGE_FILES = Object.freeze([
  'package.json', 'npm-shrinkwrap.json', 'bin/open-spec-mesh.js', 'bin/osm.js', 'lib/cli/entry.js', 'scripts/install.js', 'lib/cli/registry.js',
  'lib/runtime/location.js', 'lib/installation/cli.js', 'lib/installation/installer.js',
  'mcp/laya_http_mcp.js', 'mcp/laya-settings.json', 'mcp/templates/delegation.v1.json',
  'mcp/templates/execution-mode.v1.json', 'assets/agent-mesh-dark.svg', 'agents/index.md',
  'docs/index.md', 'sdd-init/SKILL.md', 'sdd-do/SKILL.md', 'sdd-close/SKILL.md',
]);
const REQUIRED_DEPENDENCY_FILES = Object.freeze([
  'node_modules/@modelcontextprotocol/sdk/package.json',
  'node_modules/jszip/package.json',
  'node_modules/lossless-json/package.json',
  'node_modules/smol-toml/package.json',
  'node_modules/sql.js/package.json',
  'node_modules/sql.js/dist/sql-wasm.js',
  'node_modules/sql.js/dist/sql-wasm.wasm',
]);

function globRegex(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') { index += 1; source += '(?:.*/)?'; }
      else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${source}$`, 'u');
}

function packageFiles(packageRoot, manifest) {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Package files allowlist is missing');
  const patterns = manifest.files.map((raw) => {
    if (typeof raw !== 'string') throw new Error('Unsafe package file pattern');
    const exclude = raw.startsWith('!');
    const pattern = exclude ? raw.slice(1) : raw;
    if (!pattern || path.isAbsolute(pattern) || pattern.includes('\\') || pattern.split('/').includes('..')) throw new Error('Unsafe package file pattern');
    return { exclude, regex: globRegex(pattern.replace(/^\.\//u, '')) };
  });
  const includes = patterns.filter((item) => !item.exclude);
  const excludes = patterns.filter((item) => item.exclude);
  const candidates = [];
  const walk = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.git' || name === 'node_modules') continue;
      const absolute = path.join(directory, name); const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Package resource must not be a symlink: ${relative}`);
      if (stat.isDirectory()) walk(absolute, relative);
      else if (stat.isFile()) candidates.push(relative);
    }
  };
  walk(packageRoot);
  const excluded = (relative) => {
    const pieces = relative.split('/');
    return pieces.some((piece) => piece === 'node_modules' || piece === 'tests' || piece === '__pycache__' || piece.startsWith('.'))
      || /(?:^|\/)integrations\/laya-gpu\//u.test(relative)
      || /\.(?:py|pyc|pyo)$/iu.test(relative)
      || /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|id_rsa|credentials\.json|secrets?\.json)$/iu.test(relative)
      || relative === 'package-lock.json';
  };
  const selected = candidates.filter((relative) => !excluded(relative)
    && includes.some(({ regex }) => regex.test(relative))
    && !excludes.some(({ regex }) => regex.test(relative)));
  const required = ['package.json', 'npm-shrinkwrap.json'];
  for (const item of required) if (!selected.includes(item)) selected.push(item);
  return selected.sort();
}

export function compareLockBytes(packageRoot) {
  const shrinkwrapPath = path.join(packageRoot, 'npm-shrinkwrap.json');
  if (!existsSync(shrinkwrapPath)) throw new Error('npm-shrinkwrap.json is required; refusing an unlocked runtime install');
  const shrinkwrap = readFileSync(shrinkwrapPath);
  const packageLockPath = path.join(packageRoot, 'package-lock.json');
  if (existsSync(packageLockPath)) {
    const packageLock = readFileSync(packageLockPath);
    if (!packageLock.equals(shrinkwrap)) throw new Error('package-lock.json and npm-shrinkwrap.json differ; refusing to resolve or install a changed dependency tree');
  }
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(shrinkwrap.toString('utf8'));
  if (manifest.name !== lock.name || manifest.version !== lock.version || lock.lockfileVersion < 2 || !lock.packages || !lock.packages['']) {
    throw new Error('npm-shrinkwrap.json does not describe the package manifest');
  }
  const root = lock.packages[''];
  if (JSON.stringify(root.dependencies ?? {}) !== JSON.stringify(manifest.dependencies ?? {})) {
    throw new Error('npm-shrinkwrap.json dependency roots do not match package.json');
  }
  return { manifest, shrinkwrap };
}

function copySelectedFiles(packageRoot, destination, files) {
  for (const relative of files) {
    const source = path.join(packageRoot, relative);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Required package asset is not a regular file: ${relative}`);
    const target = path.join(destination, relative);
    safePath(target);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    copyFileSync(source, target);
    chmodSync(target, stat.mode & 0o777);
  }
}

function assertResources(root) {
  for (const relative of REQUIRED_PACKAGE_FILES) {
    const file = path.join(root, relative);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Runtime resource is invalid: ${relative}`);
    } catch (error) { if (error?.code === 'ENOENT') throw new Error(`Runtime package is incomplete (missing ${relative})`); throw error; }
  }
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'open-spec-mesh' || manifest.type !== 'module' || manifest.engines?.node !== '>=22.0.0') {
    throw new Error('Runtime package identity or engine requirement is invalid');
  }
  const routes = import(pathToFileURL(path.join(root, 'lib/cli/registry.js')).href);
  return routes.then(({ COMMAND_REGISTRY }) => {
    for (const [command, [relative]] of Object.entries(COMMAND_REGISTRY)) {
      const file = path.join(root, relative);
      if (!existsSync(file)) throw new Error(`Runtime command '${command}' is missing its implementation`);
    }
  });
}

async function assertDependencies(root) {
  for (const relative of REQUIRED_DEPENDENCY_FILES) {
    const file = path.join(root, relative);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Runtime dependency resource is invalid: ${relative}`);
    } catch (error) { if (error?.code === 'ENOENT') throw new Error(`Runtime dependencies are incomplete (missing ${relative})`); throw error; }
  }
  await import(pathToFileURL(path.join(root, 'lib/installation/toml.js')).href);
  await import(pathToFileURL(path.join(root, 'lib/systemone/mcp.js')).href);
}

export function runtimeMarkerText(manifest, managedFiles) {
  return `${JSON.stringify({ schema: 1, package: PACKAGE_ID, name: manifest.name, version: manifest.version, files: managedFiles }, null, 2)}\n`;
}

function assertRuntimeTree(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const item = path.join(directory, name); const stat = lstatSync(item);
      if (stat.isSymbolicLink()) {
        const relative = path.relative(root, item).split(path.sep).join('/');
        if (!relative.startsWith('node_modules/.bin/')) throw new Error(`Refusing runtime symlink: ${relative}`);
        const resolved = realpathSync(item); const rel = path.relative(root, resolved);
        if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !statSync(resolved).isFile()) throw new Error(`Runtime binary link escapes package: ${relative}`);
      } else if (stat.isDirectory()) walk(item);
    }
  };
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing unsafe runtime directory: ${root}`);
  walk(root);
}

export function validateRuntimeOwnership(runtimeRoot, hostOwned = true) {
  assertRuntimeTree(runtimeRoot);
  const stat = lstatSync(runtimeRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing unsafe runtime directory: ${runtimeRoot}`);
  const markerPath = path.join(runtimeRoot, RUNTIME_MARKER);
  let marker;
  try {
    const markerStat = lstatSync(markerPath);
    if (markerStat.isSymbolicLink() || !markerStat.isFile()) throw new Error('Runtime ownership marker must be a regular file');
    marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch (error) { if (error?.code === 'ENOENT') throw new Error(`Unmanaged non-empty runtime directory exists: ${runtimeRoot}`); throw error; }
  if (!marker || marker.schema !== 1 || marker.package !== PACKAGE_ID || marker.name !== 'open-spec-mesh'
    || typeof marker.version !== 'string' || !Array.isArray(marker.files) || marker.files.some((item) => typeof item !== 'string' || path.isAbsolute(item) || item.split('/').includes('..') || item.includes('\\'))
    || new Set(marker.files).size !== marker.files.length) throw new Error('Runtime ownership marker is invalid');
  const packageManifest = JSON.parse(readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8'));
  if (packageManifest.name !== marker.name || packageManifest.version !== marker.version) throw new Error('Runtime marker does not match its package manifest');
  if (!hostOwned) throw new Error(`Runtime directory exists without matching host ownership: ${runtimeRoot}`);
  return marker;
}

export async function buildRuntimeStage(packageRoot, destination, { host, withLaya = false, npmPath, env = process.env, reporter = () => {} } = {}) {
  const { manifest } = compareLockBytes(packageRoot);
  if (manifest.engines?.node !== '>=22.0.0') throw new Error('Package Node engine must remain >=22.0.0');
  const files = packageFiles(packageRoot, manifest);
  for (const relative of REQUIRED_PACKAGE_FILES) if (!files.includes(relative)) throw new Error(`Package files omit required runtime asset: ${relative}`);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  copySelectedFiles(packageRoot, destination, files);
  await assertResources(destination);
  const npm = npmPath ?? resolveExecutable('npm', env);
  if (!npm) throw new Error('npm is required to create the self-contained runtime');
  reporter('  RUNTIME install locked dependencies (npm ci --omit=dev --ignore-scripts)');
  const result = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: destination, env: researchInstallEnv(env, FORWARDED_ENV), encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Unable to install locked runtime dependencies (npm exit ${result.status ?? 'I/O failure'})`);
  await assertDependencies(destination);
  const settings = path.join(destination, 'mcp/laya-settings.json');
  writeFileSync(settings, `${JSON.stringify({ enabled: withLaya })}\n`, { mode: 0o600 });
  const markerPath = path.join(destination, RUNTIME_MARKER);
  writeFileSync(markerPath, runtimeMarkerText(manifest, files), { flag: 'wx', mode: 0o600 });
  return { root: destination, files, markerPath, packageManifest: manifest, lockSha256: await shaFile(path.join(destination, 'npm-shrinkwrap.json')) };
}

async function shaFile(file) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export const RUNTIME_INTERNALS = Object.freeze({ globRegex, packageFiles, compareLockBytes, assertResources, assertRuntimeTree, REQUIRED_PACKAGE_FILES, REQUIRED_DEPENDENCY_FILES });
