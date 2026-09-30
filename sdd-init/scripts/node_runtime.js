import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function packageAt(directory) {
  try {
    const rootStat = lstatSync(directory);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    const manifestPath = path.join(directory, 'package.json');
    const stat = lstatSync(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const locator = path.join(directory, 'lib/runtime/location.js');
    const locatorStat = lstatSync(locator);
    if (manifest.name !== 'open-spec-mesh' || manifest.type !== 'module' || locatorStat.isSymbolicLink() || !locatorStat.isFile()) return null;
    return realpathSync(directory);
  } catch { return null; }
}

function discoverBootstrapRoot(entryUrl) {
  const entryPath = fileURLToPath(entryUrl);
  let cursor = path.dirname(entryPath);
  for (let depth = 0; depth < 14; depth += 1) {
    const found = packageAt(cursor);
    if (found) return found;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const parts = path.resolve(entryPath).split(path.sep).filter(Boolean);
  const skillsIndex = parts.lastIndexOf('skills');
  if (skillsIndex >= 1 && parts[skillsIndex + 2] === 'scripts') {
    const home = path.join(path.sep, ...parts.slice(0, skillsIndex));
    const managed = path.join(home, 'open-spec-mesh');
    try { const stat = lstatSync(managed); if (stat.isSymbolicLink() || !stat.isDirectory()) return null; } catch { return null; }
    const installed = packageAt(path.join(managed, 'runtime'));
    if (installed) return installed;
  }
  throw new Error(`Unable to locate a valid open-spec-mesh runtime from ${entryPath}`);
}

const bootstrapRoot = discoverBootstrapRoot(import.meta.url);
const location = await import(pathToFileURL(path.join(bootstrapRoot, 'lib/runtime/location.js')).href);
export const resolveRuntime = location.resolveRuntime;
export const runtimeFile = location.runtimeFile;
export const runtimeModuleUrl = location.runtimeModuleUrl;

export async function runCommand(command, argv = [], streams = {}) {
  const runtime = resolveRuntime(import.meta.url);
  const { runCommand: dispatch } = await import(runtimeModuleUrl(import.meta.url, 'lib/cli/registry.js'));
  return dispatch(command, argv, { ...streams, runtime });
}

export async function runSkillCommand(command, argv = process.argv.slice(2), streams = {}) {
  return runCommand(command, argv, streams);
}

export function isMain(entryUrl) {
  if (!entryUrl) throw new TypeError("isMain requires the caller import.meta.url");
  return Boolean(process.argv[1]) && entryUrl === pathToFileURL(path.resolve(process.argv[1])).href;
}

export async function invokeRuntimeHandler(relativePath, exportName, argv, streams = {}) {
  const module = await import(runtimeModuleUrl(import.meta.url, relativePath));
  const handler = module[exportName];
  if (typeof handler !== 'function') throw new Error(`Runtime handler is missing: ${relativePath}#${exportName}`);
  return handler(argv, streams);
}
