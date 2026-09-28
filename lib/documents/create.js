import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rootPath, inside } from './common.js';
import { allocate, titleCheck, withProjectLock } from './numbering.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine } from '../cli/output.js';

function englishSlug(title) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(title)) throw new Error('Document filename must be an English slug');
}

export function createDocument(root, parent, title, { directory = false } = {}) {
  const canonicalRoot = rootPath(root);
  if (!directory) englishSlug(title);
  return withProjectLock(canonicalRoot, () => allocate(canonicalRoot, inside(canonicalRoot, parent), title, { directory }));
}

export async function runNewDocument(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['parent', 'title'], options: { directory: { kind: 'boolean' }, root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh new-document PARENT TITLE [--directory] [--root PROJECT]\n'); return 0; }
  writeLine(await createDocument(args.root, args.parent, args.title, { directory: args.directory }), io.stdout);
  return 0;
}

export function readResource(relative) {
  return readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), relative), 'utf8');
}
