import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseToml } from './toml.js';
import { FORWARDED_ENV } from '../systemone/contracts.js';

export const TOOLS_DIR = '.open-spec-mesh-tools';
export const RESEARCH_TOOLS = Object.freeze([
  Object.freeze({ server: 'codegraph', package: '@colbymchenry/codegraph', binary: 'codegraph', keys: [] }),
  Object.freeze({ server: 'context7', package: '@upstash/context7-mcp', binary: 'context7-mcp', keys: ['CONTEXT7_API_KEY'] }),
  Object.freeze({ server: 'tavily', package: 'tavily-mcp', binary: 'tavily-mcp', keys: ['TAVILY_API_KEY'] }),
]);
export const LEGACY_CODEGRAPH_PACKAGE = '@astudioplus/codegraph-mcp';
export const LAYA_ENV_VARS = Object.freeze(['LAYA_BASE_URL', 'LAYA_API_KEY']);
export const TYPESAFE_ENV_VARS = Object.freeze(['TYPESAFE_API_KEY']);
export const RETIRED_LAYA_ENV = Object.freeze(['LAYA_BATCH_PATH']);

export function safePath(target) {
  const absolute = path.resolve(target);
  let cursor = absolute;
  while (true) {
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${cursor}`);
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

export function safeTree(target) {
  safePath(target);
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  for (const entry of readdirSync(target)) safeTree(path.join(target, entry));
}

export function checkResearchKeys({ env = process.env, required = true, reporter = () => {} } = {}) {
  const missing = [];
  for (const tool of RESEARCH_TOOLS) for (const name of tool.keys) {
    const present = Boolean(String(env[name] ?? '').trim());
    reporter(`  ENV ${name}: ${present ? 'present (value hidden; not authenticated)' : 'MISSING (unset or empty)'}`);
    if (!present) missing.push(name);
  }
  if (missing.length) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    if (required) throw new Error(`${message}; export them in the invoking shell and rerun the install command`);
    reporter(`  WARNING ${message}; tool readiness is NOT verified`);
  }
  return missing;
}

export function researchInstallEnv(env = process.env, forwarded = []) {
  const clean = { ...env };
  for (const tool of RESEARCH_TOOLS) for (const name of tool.keys) delete clean[name];
  for (const name of [...forwarded, ...RETIRED_LAYA_ENV]) delete clean[name];
  return clean;
}

export function resolveExecutable(command, env = process.env) {
  if (typeof command !== 'string' || !command) return null;
  const candidates = command.includes(path.sep) || (path.sep === '\\' && command.includes('/'))
    ? [path.resolve(command)]
    : String(env.PATH ?? '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, command));
  for (const candidate of candidates) {
    try {
      const stat = (awaitlessStat(candidate));
      if (stat.isFile()) { accessSync(candidate, constants.X_OK); return candidate; }
    } catch { /* try the next PATH entry */ }
  }
  return null;
}
function awaitlessStat(file) { return statSync(file); }

function packageNameNear(file, packageName) {
  let current;
  try { current = realpathSync(file); } catch { return false; }
  for (let count = 0; count < 6; count += 1) {
    const manifest = path.join(current, 'package.json');
    try { if (JSON.parse(readFileSync(manifest, 'utf8')).name === packageName) return true; } catch { /* parent is not a package */ }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

export function researchExecutable(file, packageName, { managed = false } = {}) {
  const executable = resolveExecutable(file);
  if (!executable) return false;
  if (packageName === '@colbymchenry/codegraph') {
    let current = path.dirname(path.resolve(executable));
    for (let count = 0; count < 6; count += 1) {
      const manifest = path.join(current, 'package.json');
      if (existsSync(manifest)) return packageNameNear(executable, packageName);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return !managed;
  }
  return true;
}

export function legacyCodegraph(config, home) {
  if (!config || Object.hasOwn(config, 'url')) return false;
  const command = config.command; const args = config.args ?? [];
  const oldManaged = path.join(home, TOOLS_DIR, 'node_modules/.bin/codegraph-mcp');
  return ((command === 'codegraph-mcp' || command === oldManaged) && Array.isArray(args) && args.length === 0)
    || (command === 'npx' && Array.isArray(args) && [
      ['-y', LEGACY_CODEGRAPH_PACKAGE], ['-y', `${LEGACY_CODEGRAPH_PACKAGE}@latest`],
    ].some((expected) => expected.length === args.length && expected.every((item, index) => item === args[index])));
}

export function managedResearchConfig(config, home, server, binary) {
  if (!config || Object.hasOwn(config, 'url')) return false;
  const commands = [binary, path.join(home, TOOLS_DIR, 'node_modules/.bin', binary), path.join(home, TOOLS_DIR, server, 'node_modules/.bin', binary)];
  const expected = server === 'codegraph' ? ['serve', '--mcp'] : [];
  return commands.includes(config.command) && Array.isArray(config.args ?? [])
    && expected.length === (config.args ?? []).length && expected.every((value, index) => value === config.args[index]);
}

function readServers(configPath, configData) {
  const config = configData && typeof configData === 'object' ? configData : (existsSync(configPath) ? parseToml(readFileSync(configPath, 'utf8')) : {});
  const servers = config.mcp_servers ?? {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('mcp_servers must be a table');
  return servers;
}

export function ensureResearchTools(home, { dryRun = false, installTools = true, reporter = () => {}, env = process.env, npmPath = null, configData = null } = {}) {
  const configPath = path.join(home, 'config.toml');
  safePath(configPath);
  const servers = readServers(configPath, configData);
  checkResearchKeys({ env, required: installTools && !dryRun, reporter });
  const prefix = path.join(home, TOOLS_DIR);
  safePath(prefix);
  const commands = {}; const missing = [];
  for (const tool of RESEARCH_TOOLS) {
    const config = servers[tool.server];
    if (config !== undefined) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`mcp_servers.${tool.server} must be a table`);
      if (config.enabled === false) { reporter(`  TOOL preserve disabled mcp_servers.${tool.server}`); continue; }
      const old = tool.server === 'codegraph' && legacyCodegraph(config, home);
      if (!old && !managedResearchConfig(config, home, tool.server, tool.binary)) {
        reporter(`  TOOL preserve mcp_servers.${tool.server} (custom; not probed)`); continue;
      }
      if (old) reporter('  TOOL migrate CodeGraph: @astudioplus/codegraph-mcp -> @colbymchenry/codegraph');
    }
    const destination = path.join(prefix, tool.server);
    for (const directory of [destination, path.join(destination, 'node_modules'), path.join(destination, 'node_modules/.bin')]) safePath(directory);
    const candidates = [path.join(destination, 'node_modules/.bin', tool.binary), path.join(prefix, 'node_modules/.bin', tool.binary)];
    let found = candidates.find((candidate) => researchExecutable(candidate, tool.package, { managed: true }));
    if (!found) {
      const global = resolveExecutable(tool.binary, env);
      if (global && researchExecutable(global, tool.package)) found = global;
    }
    if (found) { commands[tool.server] = found; reporter(`  TOOL reuse ${tool.server}: ${found}`); }
    else {
      commands[tool.server] = candidates[0];
      missing.push({ ...tool, destination });
      reporter(`  TOOL ${installTools && !dryRun ? 'install' : 'planned'} ${tool.server}: ${tool.package}@latest`);
    }
  }
  if (!installTools || dryRun || missing.length === 0) {
    if (!installTools) reporter('  WARNING tool installation skipped; host config references PATH commands');
    return commands;
  }
  const npm = npmPath ?? resolveExecutable('npm', env);
  if (!npm) throw new Error('Node.js and npm are required to install CodeGraph, Context7 and Tavily');
  for (const tool of missing) {
    safePath(tool.destination);
    mkdirSync(tool.destination, { recursive: true, mode: 0o700 });
    const result = spawnSync(npm, ['install', '--prefix', tool.destination, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--engine-strict', `${tool.package}@latest`], {
      cwd: tool.destination, env: researchInstallEnv(env, FORWARDED_ENV), encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw new Error(`Unable to install ${tool.package}@latest (npm exit ${result.status ?? 'I/O failure'})`);
    const executable = path.join(tool.destination, 'node_modules/.bin', tool.binary);
    if (!researchExecutable(executable, tool.package, { managed: true })) throw new Error(`Installed package has no valid ${tool.binary} executable: ${tool.package}`);
    reporter(`  TOOL installed ${tool.server} (package present; runtime not authenticated)`);
  }
  return commands;
}

export function managedResearchCommands(home) {
  return Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.server, path.join(home, TOOLS_DIR, tool.server, 'node_modules/.bin', tool.binary)]));
}
