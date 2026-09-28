import { realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';

export function rootPath(value) {
  const resolved = realpathSync(path.resolve(String(value)));
  if (!lstatSync(resolved).isDirectory()) throw new Error(`Project directory does not exist: ${resolved}`);
  return resolved;
}

export function safeInside(root, ...parts) {
  const canonicalRoot = path.resolve(root);
  const segments = parts.flatMap((part) => String(part).split(/[\\/]+/u));
  if (parts.some((part) => path.isAbsolute(String(part))) || segments.some((part) => part === '..')) {
    throw new Error(`Path escapes project: ${path.join(canonicalRoot, ...parts.map(String))}`);
  }
  const candidate = path.resolve(canonicalRoot, ...parts.map(String));
  const relative = path.relative(canonicalRoot, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project: ${candidate}`);
  }
  let cursor = canonicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink is not a writable SDD path: ${cursor}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return candidate;
}

export function assertRegularDirectory(directory) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${directory}`);
}
