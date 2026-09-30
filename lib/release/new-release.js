import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { rootPath, optionalMetadata as metadata, renderSpec } from '../documents/common.js';
import { readTextCompat } from '../runtime/text.js';
import { atomicWrite } from '../runtime/io.js';
function writeSpec(file, fields, body) { atomicWrite(file, Buffer.from(renderSpec(fields, body)), { preserveMode: true }); }
import { safeInside } from '../runtime/paths.js';
import { withProjectLock } from '../runtime/locks.js';
import { allocate, titleCheck, refresh } from '../documents/numbering.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine, writeError } from '../cli/output.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function resource(relative) { return readTextCompat(path.join(packageRoot, relative)); }
export async function createRelease(rootValue, version, title, changes = []) {
  const root = rootPath(rootValue);
  titleCheck(title);
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(version)) throw new Error('Use a semantic version');
  if (!Array.isArray(changes) || new Set(changes).size !== changes.length) throw new Error('Provide unique completed Changes');
  const noteTemplate = resource('sdd-release/references/release-template.md');
  const checklistTemplate = resource('sdd-release/references/release-checklist-template.md');
  return withProjectLock(root, () => {
    const parent = safeInside(root, 'docs/09-delivery/D01-发布记录');
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = safeInside(root, 'docs/09-delivery/D01-发布记录', entry.name);
      const fields = metadata(readTextCompat(path.join(directory, 'index.md')))[0];
      if (fields.version === version) throw new Error('Version already exists');
    }
    for (const changeId of changes) {
      const index = safeInside(root, 'docs/05-changes/C02-已完成', changeId, 'index.md');
      const fields = metadata(readTextCompat(index))[0];
      if ((fields.id && fields.id !== changeId) || (fields.status && fields.status !== 'completed')) throw new Error('Change is not completed');
    }
    const directory = allocate(root, parent, `v${version.replaceAll('.', '-')}`, { directory: true });
    const note = allocate(root, directory, 'release-notes', { content: noteTemplate });
    const checklist = allocate(root, directory, 'release-checklist', { content: checklistTemplate });
    const fields = { version, title, ...(changes.length ? { changes: changes.join(',') } : {}), note: path.basename(note), checklist: path.basename(checklist) };
    writeSpec(path.join(directory, 'index.md'), fields, `\n# ${title}\n`);
    refresh(directory);
    return directory;
  });
}
export async function runNewRelease(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout; const stderr = io.stderr ?? process.stderr;
  try {
    const args = parseArgs(argv, { positionals: ['version', 'title'], options: { changes: { kind: 'multiple', default: [] }, root: { kind: 'value', default: process.cwd() } }, command: 'new-release' });
    if (args.help) { stdout.write('Usage: open-spec-mesh new-release VERSION TITLE [--changes CHANGE_ID...] [--root PROJECT]\n'); return 0; }
    writeLine(await createRelease(args.root, args.version, args.title, args.changes), stdout);
    return 0;
  } catch (error) { writeError(error, stderr); return error instanceof UsageError ? error.exitCode : 1; }
}
