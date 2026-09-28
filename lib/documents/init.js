import { existsSync, readdirSync, lstatSync, mkdirSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { resolveRuntime } from '../runtime/location.js';
import { createText } from '../runtime/io.js';
import { readTextCompat } from '../runtime/text.js';
import { safeInside, rootPath } from '../runtime/paths.js';
import { withProjectLock } from '../runtime/locks.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine } from '../cli/output.js';
import { AREAS, CODE, refresh } from './numbering.js';

const runtime = resolveRuntime(import.meta.url);
const templates = path.join(runtime.resourceRoot, 'sdd-init/templates');
const manifest = JSON.parse(readTextCompat(path.join(templates, 'scaffold-manifest.json')));
const codePattern = new RegExp(`^(${CODE})-`, 'u');

function templatePath(kind, relative) {
  const target = path.resolve(templates, kind, relative);
  const rel = path.relative(path.join(templates, kind), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Scaffold template path escapes package resources');
  return target;
}

function itemCode(target) {
  const match = path.basename(target).match(codePattern);
  if (!match) throw new Error(`Invalid scaffold code: ${path.basename(target)}`);
  return match[1];
}

function existingDirectory(pathname) {
  try {
    const stat = lstatSync(pathname);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function preflightPath(root, relative, expectDirectory) {
  const target = safeInside(root, 'docs', ...relative.split('/'));
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not a writable SDD path: ${target}`);
    if (stat.isDirectory() !== expectDirectory) throw new Error(`Conflicting path type: ${target}`);
    return;
  }
  const parent = path.dirname(target);
  if (!existsSync(parent)) return;
  const expectedCode = itemCode(target);
  for (const entry of readdirSync(parent)) {
    const match = entry.match(codePattern);
    if (match && match[1] === expectedCode) throw new Error(`Number occupied; reconcile existing content first: ${target}`);
  }
}

function walkDirectories(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error(`Symlink: ${child}`);
      if (stat.isDirectory()) { output.push(child); visit(child); }
    }
  };
  visit(root);
  return output;
}

export function initializeUnlocked(root) {
  const canonicalRoot = rootPath(root);
  const docs = safeInside(canonicalRoot, 'docs');
  const agents = safeInside(canonicalRoot, 'AGENTS.md');
  if (existsSync(agents) && !lstatSync(agents).isFile()) throw new Error('AGENTS.md must be a regular file');
  const projectRules = existsSync(agents) ? null : readTextCompat(path.join(runtime.resourceRoot, 'sdd-init/references/project-agents-template.md'));

  for (const relative of [...manifest.directories, ...manifest.files]) {
    const isDirectory = manifest.directories.includes(relative);
    preflightPath(canonicalRoot, relative, isDirectory);
    if (!isDirectory) readTextCompat(templatePath('files', relative));
    else readTextCompat(templatePath('directories', `${relative}/index.md`));
  }

  mkdirSync(docs, { recursive: true });
  for (const area of Object.keys(AREAS)) mkdirSync(safeInside(canonicalRoot, 'docs', area), { recursive: true });
  if (!existsSync(path.join(docs, 'index.md'))) createText(path.join(docs, 'index.md'), [
    '# Project Documentation', '', '## Current Truth', '',
    '- [Product](02-product/index.md)', '- [Architecture](03-architecture/index.md)', '- [Operations](04-operations/index.md)', '',
    '## Engineering Records', '', '- [Governance](01-governance/index.md)', '- [Changes](05-changes/index.md)',
    '- [Decisions](06-decisions/index.md)', '- [Research](07-research/index.md)', '- [Quality](08-quality/index.md)', '- [Delivery](09-delivery/index.md)', '',
  ].join('\n'));

  for (const relative of manifest.directories) {
    const directory = safeInside(canonicalRoot, 'docs', ...relative.split('/'));
    mkdirSync(directory, { recursive: true });
    const index = path.join(directory, 'index.md');
    if (!existsSync(index)) createText(index, readTextCompat(templatePath('directories', `${relative}/index.md`)));
  }
  for (const relative of manifest.files) {
    const target = safeInside(canonicalRoot, 'docs', ...relative.split('/'));
    if (!existsSync(target)) createText(target, readTextCompat(templatePath('files', relative)));
  }

  const directories = [docs, ...walkDirectories(docs)].sort((a, b) => {
    const depth = path.relative(docs, b).split(path.sep).length - path.relative(docs, a).split(path.sep).length;
    return depth || a.localeCompare(b, 'en');
  });
  for (const directory of directories) refresh(directory);
  if (projectRules !== null) createText(agents, projectRules);
  return canonicalRoot;
}

export function initialize(root) {
  const canonicalRoot = rootPath(root);
  return withProjectLock(canonicalRoot, () => initializeUnlocked(canonicalRoot));
}

export async function runInitProject(argv, io = {}) {
  const args = parseArgs(argv, { options: { root: { kind: 'value', default: process.cwd() } }, command: 'init-project' });
  if (args.help) {
    (io.stdout ?? process.stdout).write('Usage: open-spec-mesh init-project [--root PROJECT]\n');
    return 0;
  }
  if (args._.length) throw new UsageError(`unrecognized arguments: ${args._.join(' ')}`);
  const result = await initialize(args.root);
  writeLine(result, io.stdout);
  return 0;
}
