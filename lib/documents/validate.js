import path from 'node:path';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { rootPath, metadata } from './common.js';
import { readTextCompat } from '../runtime/text.js';
import { AREAS, CODE, titleCheck, prefix } from './numbering.js';
import { visibleLines } from './markdown.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine } from '../cli/output.js';

const numbered = new RegExp(`^(${CODE})-([0-9]+)-(.+)$`, 'u');
const change = /^CHG-[0-9]{8}-.+$/u;

function runtimeGraph(pathname) {
  if (path.basename(pathname) !== 'C03-task-graph.json' || path.basename(path.dirname(pathname)) !== 'C03-tasks') return false;
  const changeDirectory = path.dirname(path.dirname(pathname));
  if (!change.test(path.basename(changeDirectory))) return false;
  try {
    const [fields] = metadata(readTextCompat(path.join(changeDirectory, 'index.md')));
    return fields.graph === 'C03-tasks/C03-task-graph.json';
  } catch { return false; }
}

function walkDirectories(directory, errors) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) { errors.push(`Symlink: ${target}`); continue; }
    if (stat.isDirectory()) { output.push(target); output.push(...walkDirectories(target, errors)); }
  }
  return output;
}

function walkMarkdown(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) output.push(...walkMarkdown(target));
    else if (stat.isFile() && entry.name.endsWith('.md')) output.push(target);
  }
  return output;
}

export function validate(root) {
  const canonicalRoot = rootPath(root);
  const docs = path.join(canonicalRoot, 'docs');
  const errors = [];
  try {
    const stat = lstatSync(docs);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return ['docs must be a real directory'];
  } catch (error) {
    if (error?.code === 'ENOENT') return ['docs must be a real directory'];
    throw error;
  }
  const rootEntries = readdirSync(docs, { withFileTypes: true });
  if (rootEntries.some((entry) => entry.name !== 'index.md' && !entry.isDirectory())) errors.push('Only index.md and categories allowed at docs root');
  const rootDirectories = rootEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (rootDirectories.length !== Object.keys(AREAS).length || rootDirectories.some((name) => !Object.hasOwn(AREAS, name))) errors.push('Expected consecutive 01–09 categories');

  const directories = [docs, ...walkDirectories(docs, errors)];
  for (const directory of directories) {
    if (!existsSync(path.join(directory, 'index.md'))) errors.push(`Missing index: ${directory}`);
    if (directory === docs) continue;
    let stem;
    try { stem = prefix(canonicalRoot, directory); } catch (error) { errors.push(error.message); continue; }
    const lead = stem.length === 1 ? stem : `${stem}-`;
    const width = stem === 'ADR' ? 3 : 2;
    const seen = new Set();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink() || entry.name === 'index.md') continue;
      if (entry.isFile() && (runtimeGraph(child) || entry.name === 'C03-task-plan.md')) continue;
      if (entry.isFile() && path.extname(entry.name) !== '.md') errors.push(`Non-Markdown document: ${child}`);
      let title;
      if ((path.basename(directory) === 'C01-进行中' || path.basename(directory) === 'C02-已完成') && entry.isDirectory() && change.test(entry.name)) {
        title = entry.name.slice(13);
      } else {
        const match = entry.name.match(new RegExp(`^${lead}([0-9]{${width}})-(.+)$`, 'u'));
        if (!match) { errors.push(`Invalid numbering: ${child}`); continue; }
        if (seen.has(match[1]) || Number(match[1]) === 0) errors.push(`Duplicate/zero number: ${child}`);
        seen.add(match[1]);
        title = entry.isDirectory() ? match[2] : path.parse(match[2]).name;
      }
      if (entry.isFile() && !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(title)) errors.push(`Document filename must be English: ${child}`);
      try { titleCheck(title); } catch { errors.push(`Invalid title: ${child}`); }
    }
  }

  for (const pathname of walkMarkdown(docs)) {
    try {
      const text = readTextCompat(pathname);
      for (const [, line] of visibleLines(text)) {
        for (const match of line.matchAll(/\]\(([^)]+)\)/gu)) {
          let target = match[1];
          if (target.includes('://') || target.startsWith('#') || target.startsWith('mailto:')) continue;
          target = target.split('#', 1)[0];
          if (target && !existsSync(path.resolve(path.dirname(pathname), target))) errors.push(`Broken link: ${pathname}: ${target}`);
        }
      }
    } catch (error) { errors.push(`${pathname}: ${error.message}`); }
  }
  return errors;
}

export async function runValidateDocs(argv, io = {}) {
  const args = parseArgs(argv, { options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh validate-docs [--root PROJECT]\n'); return 0; }
  if (args._.length) throw new UsageError(`unrecognized arguments: ${args._.join(' ')}`);
  const errors = validate(args.root);
  for (const error of errors) (io.stderr ?? process.stderr).write(`docs warning: ${error}\n`);
  writeLine(errors.length ? `docs: ${errors.length} advisory warnings (not stage authorization)` : 'docs: valid', io.stdout);
  return 0;
}
