import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_NAME = 'open-spec-mesh';
const REQUIRED = ['lib/cli/registry.js', 'lib/runtime/compat-json.js', 'lib/documents/init.js', 'sdd-init/templates/files/08-quality/Q01-validation.md'];

function regularPathNoLinks(root, relative) {
  let cursor = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) return false;
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return false;
  }
  return true;
}

function packageAt(directory) {
  const manifest = path.join(directory, 'package.json');
  try {
    const rootStat = lstatSync(directory);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    const stat = lstatSync(manifest);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    if (data.name !== PACKAGE_NAME || data.type !== 'module' || typeof data.version !== 'string') return null;
    if (REQUIRED.some((file) => !regularPathNoLinks(directory, file))) return null;
    return { packageRoot: realpathSync(directory), resourceRoot: realpathSync(directory), version: data.version };
  } catch { return null; }
}

function sourcePackage(entryPath) {
  let cursor = path.dirname(entryPath);
  for (let depth = 0; depth < 14; depth += 1) {
    const found = packageAt(cursor);
    if (found) return found;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function installedPackage(entryPath) {
  const parts = path.resolve(entryPath).split(path.sep).filter(Boolean);
  const index = parts.lastIndexOf('skills');
  if (index < 1 || index + 2 >= parts.length || parts[index + 2] !== 'scripts') return null;
  const home = path.join(path.sep, ...parts.slice(0, index));
  const managed = path.join(home, 'open-spec-mesh');
  try {
    const managedStat = lstatSync(managed);
    if (managedStat.isSymbolicLink() || !managedStat.isDirectory()) return null;
  } catch { return null; }
  const runtime = path.join(managed, 'runtime');
  return packageAt(runtime);
}

export function resolveRuntime(entryUrl = import.meta.url) {
  const entryPath = entryUrl instanceof URL || String(entryUrl).startsWith('file:')
    ? fileURLToPath(entryUrl)
    : path.resolve(String(entryUrl));
  const found = sourcePackage(entryPath) ?? installedPackage(entryPath);
  if (!found) throw new Error(`Unable to locate a valid ${PACKAGE_NAME} runtime from ${entryPath}`);
  return Object.freeze(found);
}

export function runtimeFile(entryUrl, relativePath) {
  const runtime = resolveRuntime(entryUrl);
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error('Runtime resource path escapes package');
  const target = path.resolve(runtime.resourceRoot, normalized);
  const relative = path.relative(runtime.resourceRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Runtime resource path escapes package');
  return target;
}

export function runtimeModuleUrl(entryUrl, relativePath) {
  return pathToFileURL(runtimeFile(entryUrl, relativePath));
}
