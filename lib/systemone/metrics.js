import { closeSync, constants, fchmodSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import { encode, metricsPath } from './contracts.js';

function noSymlinkPath(target) {
  let cursor = path.resolve(target);
  while (true) {
    try { if (lstatSync(cursor).isSymbolicLink()) return false; }
    catch (error) { if (error.code !== 'ENOENT') return false; }
    const parent = path.dirname(cursor);
    if (parent === cursor) return true;
    cursor = parent;
  }
}


export function writeMetric(event, env) {
  const target = metricsPath(env);
  if (!target) return null;
  if (!path.isAbsolute(target) || !noSymlinkPath(target)) return false;
  let fd;
  try {
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (!noSymlinkPath(target)) return false;
    const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
    fd = openSync(target, flags, 0o600);
    fchmodSync(fd, 0o600);
    const line = Buffer.concat([encode(event), Buffer.from('\n')]);
    let offset = 0;
    while (offset < line.length) offset += writeSync(fd, line, offset, line.length - offset);
    closeSync(fd);
    return true;
  } catch {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    return false;
  }
}
