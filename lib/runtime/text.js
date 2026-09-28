import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function decodeUtf8Compat(bytes) {
  return utf8.decode(bytes).replace(/\r\n?/g, '\n');
}

export function readTextCompat(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Required regular file missing: ${path}`);
  }
  return decodeUtf8Compat(readFileSync(path));
}

export function pythonRstrip(value) {
  return value.replace(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/u, '');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
