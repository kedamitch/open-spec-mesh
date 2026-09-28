import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  fchmodSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { decodeUtf8Compat } from './text.js';

export function readBytes(pathname) {
  const stat = lstatSync(pathname);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Required regular file missing: ${pathname}`);
  return readFileSync(pathname);
}

export function readText(pathname) {
  return decodeUtf8Compat(readBytes(pathname));
}

export function createExclusive(pathname, bytes, { mode = 0o666 } = {}) {
  const fd = openSync(pathname, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function atomicWrite(pathname, bytes, { mode = 0o600, preserveMode = false } = {}) {
  const target = path.resolve(pathname);
  const parent = path.dirname(target);
  let cursor = parent;
  while (true) {
    const parentStat = lstatSync(cursor);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error(`Refusing unsafe parent directory: ${cursor}`);
    const previous = path.dirname(cursor);
    if (previous === cursor) break;
    cursor = previous;
  }
  let targetMode = mode;
  try {
    const current = lstatSync(target);
    if (current.isSymbolicLink()) throw new Error(`Refusing symlink: ${target}`);
    if (!current.isFile()) throw new Error(`Refusing non-file target: ${target}`);
    if (preserveMode) targetMode = current.mode & 0o777;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temp = path.join(parent, `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  let fd;
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), targetMode);
    fchmodSync(fd, targetMode);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, target);
    try {
      const dirFd = openSync(parent, constants.O_RDONLY);
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF'].includes(error?.code)) throw error;
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') throw cleanupError; }
    throw error;
  }
}

export function createText(pathname, text) {
  createExclusive(pathname, Buffer.from(text, 'utf8'));
}

export function ensureDirectory(pathname, mode = 0o700) {
  mkdirSync(pathname, { recursive: true, mode });
  const stat = lstatSync(pathname);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Expected a real directory: ${pathname}`);
}

export function fileMode(pathname) {
  return statSync(pathname).mode & 0o777;
}
