import path from 'node:path';
import { resolveRuntime } from '../runtime/location.js';
import { rmSync } from 'node:fs';
import { refresh } from './numbering.js';
import { readTextCompat } from '../runtime/text.js';
import { rootPath, inside } from './common.js';
import { allocate, titleCheck, withProjectLock } from './numbering.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine } from '../cli/output.js';

const runtime = resolveRuntime(import.meta.url);

export function createResearch(root, title) {
  titleCheck(title);
  const canonicalRoot = rootPath(root);
  const template = readTextCompat(path.join(runtime.resourceRoot, 'sdd-research/references/research-template.md'));
  return withProjectLock(canonicalRoot, () => {
    const directory = allocate(canonicalRoot, inside(canonicalRoot, 'docs', '07-research'), title, { directory: true });
    try { allocate(canonicalRoot, directory, 'research-report', { content: template }); }
    catch (error) {
      try { rmSync(directory, { recursive: true, force: true }); refresh(path.dirname(directory)); }
      catch (rollbackError) { throw new Error(`${error.message}; research directory requires recovery at ${directory}: ${rollbackError.message}`, { cause: error }); }
      throw error;
    }
    return directory;
  });
}

export function createAdr(root, title) {
  titleCheck(title);
  const canonicalRoot = rootPath(root);
  const template = readTextCompat(path.join(runtime.resourceRoot, 'sdd-research/references/adr-template.md'));
  if (!template.startsWith('# ') || !template.includes('\n')) throw new Error('ADR template requires a title and body');
  const content = `# ${title}\n${template.slice(template.indexOf('\n') + 1)}`;
  return withProjectLock(canonicalRoot, () => allocate(canonicalRoot, inside(canonicalRoot, 'docs', '06-decisions'), 'decision', { content }));
}

export async function runNewResearch(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['title'], options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh new-research TITLE [--root PROJECT]\n'); return 0; }
  writeLine(await createResearch(args.root, args.title), io.stdout);
  return 0;
}

export async function runNewAdr(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['title'], options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh new-adr TITLE [--root PROJECT]\n'); return 0; }
  writeLine(await createAdr(args.root, args.title), io.stdout);
  return 0;
}
