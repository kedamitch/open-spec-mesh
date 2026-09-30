import path from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { safeInside, rootPath } from '../runtime/paths.js';
import { readTextCompat } from '../runtime/text.js';

export const CHANGE_ID = /^CHG-[0-9]{8}-[^/\\]+$/u;
export { rootPath };

export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function inside(root, ...parts) {
  return safeInside(root, ...parts);
}

export function metadata(text) {
  const lines = text.split('\n');
  if (!lines.length || lines[0].trim() !== '---') throw new Error('Spec requires scalar frontmatter.');
  const fields = Object.create(null);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') return [fields, lines.slice(index + 1).join('\n')];
    const line = lines[index];
    const separator = line.indexOf(':');
    const key = separator < 0 ? '' : line.slice(0, separator).trim();
    const value = separator < 0 ? '' : line.slice(separator + 1).trim();
    if (!key || !value || Object.hasOwn(fields, key)) throw new Error('Spec frontmatter contains an invalid or duplicate field.');
    fields[key] = value;
  }
  throw new Error('Spec frontmatter is not closed.');
}

export function renderSpec(fields, body) {
  const head = Object.entries(fields).map(([key, value]) => `${key}: ${String(value)}\n`).join('');
  return `---\n${head}---\n${body}`;
}

export function mappedDocument(root, directory, fields, key, required = true) {
  const name = fields[key] ?? '';
  if (!name) {
    if (required) throw new Error(`Missing document mapping: ${key}`);
    return null;
  }
  if (path.isAbsolute(name) || name.includes('\\') || name.split('/').includes('..')) throw new Error(`Invalid document mapping: ${key}`);
  if (key !== 'graph' && path.posix.basename(name) !== name) throw new Error(`Invalid document mapping: ${key}`);
  const resolved = inside(root, path.relative(root, directory), ...name.split('/'));
  readTextCompat(resolved);
  return resolved;
}

export function activeChange(root, changeId) {
  if (typeof changeId !== 'string' || !CHANGE_ID.test(changeId)) throw new Error('Use the complete CHG-YYYYMMDD-name identifier.');
  const change = inside(root, 'docs', '05-changes', 'C01-进行中', changeId);
  if (!existsSync(change) || !readStatDirectory(change)) throw new Error(`Active Change not found: ${changeId}`);
  const index = readTextCompat(path.join(change, 'index.md'));
  const [fields, body] = index.startsWith('---\n') ? metadata(index) : [Object.create(null), index];
  if (fields.id && fields.id !== changeId) throw new Error('Change identity mismatch');
  readTextCompat(inside(root, path.relative(root, change), 'C01-change.md'));
  return [change, fields, body];
}

function readStatDirectory(pathname) {
  try {
    const stat = lstatSync(pathname);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function optionalMetadata(text) { return text.startsWith('---\n') ? metadata(text) : [Object.create(null), text]; }
