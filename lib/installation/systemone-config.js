import path from 'node:path';
import { config as validateConfig, resolveProvider, FORWARDED_ENV } from '../systemone/contracts.js';
import { LAYA_ENV_VARS, TYPESAFE_ENV_VARS, RETIRED_LAYA_ENV } from './tools.js';

export { FORWARDED_ENV, RETIRED_LAYA_ENV };

export function checkSystemOneEnvironment({ required = true, reporter = () => {}, env = process.env } = {}) {
  let provider;
  try { provider = resolveProvider(env); }
  catch (error) {
    if (required) throw error;
    reporter(`  WARNING ${error.message}; System One MCP readiness is NOT verified`);
    return ['SYSTEMONE_PROVIDER'];
  }
  reporter(`  SYSTEMONE provider: ${provider}`);
  const missing = [];
  for (const name of (provider === 'laya' ? LAYA_ENV_VARS : TYPESAFE_ENV_VARS)) {
    const present = Boolean(String(env[name] ?? '').trim());
    reporter(`  ENV ${name}: ${present ? 'present (value hidden; endpoint not probed)' : 'MISSING (unset or empty)'}`);
    if (!present) missing.push(name);
  }
  if (missing.length) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    if (required) throw new Error(`${message}; export them in the invoking shell and rerun the install command`);
    reporter(`  WARNING ${message}; System One MCP readiness is NOT verified`);
    return missing;
  }
  try { validateConfig(env); }
  catch (error) {
    if (required) throw error;
    reporter(`  WARNING ${error.message}; System One MCP readiness is NOT verified`);
  }
  return missing;
}

function isPythonCommand(command) { return /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/iu.test(path.basename(String(command ?? ''))); }
function isNodeCommand(command) { return ['node', 'node.exe'].includes(path.basename(String(command ?? '')).toLowerCase()); }

export function managedLayaConfig(value, home) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'url')) return false;
  const args = value.args ?? [];
  if (!Array.isArray(args) || args.length !== 1) return false;
  const expectedLegacy = new Set(['mcp/laya_http_mcp.py', path.join(home, 'mcp/laya_http_mcp.py')]);
  if (isPythonCommand(value.command) && expectedLegacy.has(args[0])) return true;
  const expectedNode = path.join(home, 'mcp', 'laya_http_mcp.js');
  return isNodeCommand(value.command) && path.isAbsolute(args[0]) && path.resolve(args[0]) === expectedNode;
}

export function managedNodeLayaConfig(value, home) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && !Object.hasOwn(value, 'url') && isNodeCommand(value.command)
    && Array.isArray(value.args) && value.args.length === 1
    && path.resolve(value.args[0]) === path.join(home, 'mcp', 'laya_http_mcp.js'));
}

export function layaMcpConfig(home, nodePath = process.execPath) {
  return Object.freeze({
    type: 'stdio', command: nodePath,
    args: [path.join(home, 'mcp', 'laya_http_mcp.js')],
    env_vars: [...FORWARDED_ENV], enabled: true,
  });
}

export function cleanLayaEnvironment(value) {
  const result = { ...value };
  if (Object.hasOwn(result, 'env_vars')) {
    if (!Array.isArray(result.env_vars)) throw new Error('mcp_servers.laya.env_vars must be a list');
    result.env_vars = result.env_vars.filter((item) => !RETIRED_LAYA_ENV.includes(typeof item === 'string' ? item : item?.name));
  }
  if (Object.hasOwn(result, 'env')) {
    if (!result.env || typeof result.env !== 'object' || Array.isArray(result.env)) throw new Error('mcp_servers.laya.env must be a table');
    result.env = Object.fromEntries(Object.entries(result.env).filter(([name]) => !RETIRED_LAYA_ENV.includes(name)));
  }
  return result;
}

export function retiredPythonRuntimeExists(home) {
  return path.join(home, '.open-spec-mesh-tools', 'laya', 'python');
}
