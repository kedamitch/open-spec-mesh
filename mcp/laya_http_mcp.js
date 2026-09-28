#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = fileURLToPath(import.meta.url);
const expectedName = 'open-spec-mesh';

function isRegularPath(root, relative) {
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = lstatSync(cursor); } catch { return false; }
    if (stat.isSymbolicLink()) return false;
    if (part === relative.split('/').at(-1) ? !stat.isFile() : !stat.isDirectory()) return false;
  }
  return true;
}

function validPackage(root) {
  try {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    if (!isRegularPath(root, 'package.json') || !isRegularPath(root, 'lib/systemone/cli.js')) return false;
    const data = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    return data.name === expectedName && data.type === 'module' && data.private === true && typeof data.version === 'string';
  } catch { return false; }
}

function locateRuntime() {
  let cursor = path.dirname(entry);
  for (let depth = 0; depth < 14; depth += 1) {
    if (validPackage(cursor)) return path.resolve(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const mcpDirectory = path.dirname(entry);
  const hostHome = path.dirname(mcpDirectory);
  const installed = path.join(hostHome, 'open-spec-mesh', 'runtime');
  if (validPackage(installed)) return path.resolve(installed);
  throw new Error('No valid source or installed open-spec-mesh runtime found');
}

try {
  const root = locateRuntime();
  const modulePath = path.join(root, 'lib/systemone/cli.js');
  const { main } = await import(pathToFileURL(modulePath).href);
  const code = await main({ argv: process.argv.slice(2), root, configRoot: path.dirname(entry) });
  process.exitCode = code;
} catch {
  process.stderr.write('System One MCP runtime unavailable.\n');
  process.exitCode = 1;
}
