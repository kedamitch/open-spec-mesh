import path from 'node:path';
import { mkdirSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { safeInside } from '../runtime/paths.js';
import { readBytes, readText, atomicWrite } from '../runtime/io.js';
import { legacyJson } from '../runtime/compat-json.js';
import { parseLosslessJson } from '../runtime/compat-json.js';
import { withStoreLock } from '../runtime/locks.js';
import { activeChange, git, revision } from './contract.js';

export const RECEIPT_SCHEMA = 1;
const PLACEHOLDERS = new Set(['待核实', 'pending', 'tbd', 'todo', '-', '无']);
const VALIDATION_DOC = 'docs/08-quality/Q01-validation.md';
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function validationEntryPoint(root) {
  const source = safeInside(root, VALIDATION_DOC);
  const text = readText(source);
  const lines = text.split('\n');
  const heading = '## Validation Entry Point';
  if (lines.filter((line) => line === heading).length !== 1) throw new Error('Validation config requires exactly one ## Validation Entry Point');
  const start = lines.indexOf(heading) + 1;
  let value = '';
  for (const line of lines.slice(start)) {
    if (line.startsWith('## ')) break;
    if (line.trim() && !value) value = line.trim();
  }
  if (value.length >= 2 && value.startsWith('`') && value.endsWith('`')) value = value.slice(1, -1).trim();
  const folded = value.toLocaleLowerCase('en-US');
  if (!value || PLACEHOLDERS.has(folded) || ['待核实', 'pending', 'tbd', 'todo'].some((marker) => folded.includes(marker))) throw new Error('Validation Entry Point is unresolved');
  let declaration;
  if (value.startsWith('{')) {
    const object = parseLosslessJson(value, { rejectDuplicateKeys: true });
    if (!object || Array.isArray(object) || typeof object !== 'object') throw new Error('Validation argv declaration must be a JSON object');
    if (!Array.isArray(object.argv) || !object.argv.length || object.argv.some((item) => typeof item !== 'string' || !item)) throw new Error('Validation argv must be a nonempty string array');
    if (typeof object.path !== 'string' || !object.path) throw new Error('Validation argv declaration requires a tracked path');
    declaration = { kind: 'argv', argv: object.argv, path: object.path };
  } else {
    const ext = path.posix.extname(value);
    if (!['.py', '.js', '.mjs', '.cjs'].includes(ext)) throw new Error('Validation Entry Point must name a .py/.js script or explicit argv JSON');
    declaration = { kind: ext === '.py' ? 'python' : 'node', path: value };
  }
  const relative = declaration.path;
  if (path.posix.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some((part) => part === '..' || part === '')) throw new Error('Validation Entry Point must stay inside the project');
  const file = safeInside(root, relative);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Validation Entry Point does not exist: ${relative}`);
  const bytes = readBytes(file);
  if (declaration.kind === 'argv') {
    const descriptorBytes = Buffer.concat([
      Buffer.from('\n---SDD-VALIDATION-ARGV-v1---\n', 'utf8'),
      Buffer.from(`${legacyJson(declaration.argv, { ensureAscii: false, sortKeys: true, separators: [',', ':'] })}\n`, 'utf8'),
      bytes,
    ]);
    return { kind: 'argv', argv: declaration.argv, descriptor: { path: relative, sha256: sha(descriptorBytes) } };
  }
  return { kind: declaration.kind, argv: declaration.kind === 'node' ? [process.execPath, relative] : ['python3', relative], descriptor: { path: relative, sha256: sha(bytes) } };
}

export function receiptPath(root, changeId) {
  if (!/^CHG-[0-9]{8}-[^/\\]+$/u.test(changeId)) throw new Error('Invalid Change id for validation receipt');
  const common = git(root, 'rev-parse', '--git-common-dir');
  const base = path.resolve(root, common, 'sdd-validation');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const stat = lstatSync(base);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Validation receipt directory must not be a symlink');
  return path.join(base, `${changeId}.json`);
}
export function writeReceipt(root, changeId, receipt) {
  const target = receiptPath(root, changeId);
  try { if (lstatSync(target).isSymbolicLink()) throw new Error('Validation receipt must not be a symlink'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  atomicWrite(target, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'), { mode: 0o600 });
  return target;
}
export function loadReceipt(root, changeId) {
  const target = receiptPath(root, changeId);
  try { const stat = lstatSync(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Machine validation receipt required; run run-validation.js'); }
  catch (error) { if (error?.code === 'ENOENT') throw new Error('Machine validation receipt required; run run-validation.js'); throw error; }
  try { const value = JSON.parse(readFileSync(target, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new Error('Machine validation receipt is invalid'); }
}
function sameJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]));
}

export function validateReceipt(root, changeId, integratedRevision) {
  const entrypoint = validationEntryPoint(root);
  const receipt = loadReceipt(root, changeId);
  const expected = { schema: RECEIPT_SCHEMA, change: changeId, revision: integratedRevision, entrypoint: entrypoint.descriptor, passed: true, exit_code: 0 };
  for (const [key, value] of Object.entries(expected)) if (!sameJson(receipt[key], value)) throw new Error(`Machine validation receipt mismatch: ${key}`);
  for (const key of ['stdout_sha256', 'stderr_sha256']) if (!/^[0-9a-f]{64}$/u.test(String(receipt[key] ?? ''))) throw new Error(`Machine validation receipt output digest is invalid: ${key}`);
  return receipt;
}

function codePointCompare(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function changeSnapshot(change) {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Active Change must not contain symlinks during validation');
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files.push({
        relative: path.relative(change, file).split(path.sep).join('/'),
        bytes: readFileSync(file),
      });
    }
  };
  if (lstatSync(change).isSymbolicLink()) throw new Error('Active Change must not be a symlink');
  walk(change);
  files.sort((left, right) => codePointCompare(left.relative, right.relative));
  const hash = createHash('sha256');
  for (const { relative, bytes } of files) {
    const nameBytes = Buffer.from(relative, 'utf8');
    hash.update(lengthPrefix(nameBytes.length));
    hash.update(nameBytes);
    hash.update(lengthPrefix(bytes.length));
    hash.update(bytes);
  }
  return hash.digest('hex');
}
function lengthPrefix(length) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(length));
  return bytes;
}

export function dirtyPaths(root) {
  const tracked = git(root, 'diff', '--name-only', '-z', 'HEAD').split('\0');
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0');
  return new Set([...tracked, ...untracked].filter(Boolean));
}

export async function runValidation(root, changeId, revisionValue = 'HEAD') {
  return withStoreLock(receiptPath(root, changeId), async () => {
    const [change] = activeChange(root, changeId);
    const shaValue = revision(root, revisionValue);
    if (revision(root, 'HEAD') !== shaValue) throw new Error('Validation revision must be the current checkout HEAD');
    const allowedPrefix = `${path.relative(root, change).split(path.sep).join('/').replace(/\/$/u, '')}/`;
    const beforeDirty = dirtyPaths(root);
    const entry = validationEntryPoint(root);
    const descriptorPath = entry.descriptor.path;
    const tracked = git(root, 'ls-files', '--error-unmatch', '--', descriptorPath);
    if (tracked !== descriptorPath || beforeDirty.has(descriptorPath)) throw new Error('Validation Entry Point must be tracked and committed at the validated revision');
    const unexpected = [...beforeDirty].filter((item) => !item.startsWith(allowedPrefix));
    if (unexpected.length) throw new Error(`Commit or preserve non-Change edits before integration validation: ${unexpected.sort().join(', ')}`);
    const beforeChange = changeSnapshot(change);
    const receipt = {
      schema: RECEIPT_SCHEMA,
      change: changeId,
      revision: shaValue,
      entrypoint: { path: entry.descriptor.path, sha256: entry.descriptor.sha256 },
      passed: false,
      exit_code: null,
      stdout_sha256: sha(Buffer.alloc(0)),
      stderr_sha256: sha(Buffer.alloc(0)),
    };
    writeReceipt(root, changeId, receipt); // invalidate any prior success before starting the command

    const argv = entry.argv;
    let result;
    try {
      result = spawnSync(argv[0], argv.slice(1), {
        cwd: root,
        encoding: null,
        maxBuffer: 64 * 1024 * 1024,
        shell: false,
      });
    } catch (error) {
      result = { error, status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr
      : result.error ? Buffer.from(String(result.error.message), 'utf8') : Buffer.alloc(0);
    const normalize = (bytes) => Buffer.from(bytes.toString('utf8').replace(/\r\n?/gu, '\n'), 'utf8');
    const exitCode = result.error ? null : result.status;
    let stable = false;
    try {
      stable = revision(root, 'HEAD') === shaValue
        && changeSnapshot(change) === beforeChange
        && ![...dirtyPaths(root)].some((item) => !item.startsWith(allowedPrefix));
    } catch {
      // Keep the prewritten failure receipt if validation removes/replaces an artifact.
      stable = false;
    }
    Object.assign(receipt, {
      passed: !result.error && exitCode === 0 && stable,
      exit_code: exitCode,
      stdout_sha256: sha(normalize(stdout)),
      stderr_sha256: sha(normalize(stderr)),
    });
    writeReceipt(root, changeId, receipt);
    if (result.error) throw new Error(`Integration validation could not start: ${result.error.message}`);
    if (exitCode !== 0) {
      const detail = (stderr.length ? stderr : stdout).toString('utf8').trim().split(/\r?\n/u).slice(-8).join(' | ');
      throw new Error(`Integration validation failed with exit code ${exitCode}${detail ? `: ${detail}` : ''}`);
    }
    if (!stable) throw new Error('Validation command changed the validated revision or project artifacts');
    return receipt;
  });
}
