import { existsSync, readdirSync, lstatSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { rootPath, inside } from './common.js';
import { withProjectLock } from './numbering.js';
import { atomicWrite, createText } from '../runtime/io.js';
import { readTextCompat } from '../runtime/text.js';
import { initializeUnlocked } from './init.js';
import { AREAS, refresh } from './numbering.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine } from '../cli/output.js';

function walkMarkdown(directory, relative = '') {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (stat.isDirectory()) found.push(...walkMarkdown(target, child));
    else if (stat.isFile() && entry.name.endsWith('.md')) found.push(child);
  }
  return found;
}

export function isCanonicalDocs(docs) {
  if (!existsSync(docs)) return false;
  const stat = lstatSync(docs);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  const dirs = readdirSync(docs, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name);
  return dirs.length === Object.keys(AREAS).length && dirs.every((name) => Object.hasOwn(AREAS, name));
}

export function migrationMap(legacy, relativePaths = walkMarkdown(legacy).sort(codePointCompare)) {
  const tick = '`';
  const rows = relativePaths.length
    ? relativePaths.map((name) => `| ${tick}${name}${tick} | 待迁移 | 待确认 |`).join('\n')
    : '| 无 Markdown 文档 | 已核实 | 无 |';
  return [
    '# Legacy Documentation Migration', '', '## Purpose', '',
    '记录旧文档事实迁移到当前 01–09 体系的去向。脚本只保存原文件并建立骨架，不猜测语义。', '',
    '## Legacy Source', '', '`.sdd-migration/legacy-docs/`', '', '## Migration Map', '',
    '| Legacy Document | Status | Canonical Target |', '| --- | --- | --- |', rows, '',
    '## Completion', '',
    '只有所有真实旧文档都已核对并迁入正确的 Current Truth / ADR / Research / Change，且 canonical docs 校验通过后，才可把迁移标记为完成。', '',
  ].join('\n');
}

function codePointCompare(left, right) {
  const a = Array.from(left, (c) => c.codePointAt(0));
  const b = Array.from(right, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function rollback(root, docs, migrationRoot, legacy, agents, agentsExisted) {
  const issues = [];
  try { if (existsSync(docs)) rmSync(docs, { recursive: true }); } catch (error) { issues.push(`remove generated docs failed: ${error.message}`); }
  try {
    if (existsSync(legacy) && !existsSync(docs)) renameSync(legacy, docs);
    else if (existsSync(legacy)) issues.push(`legacy source remains at ${legacy}`);
  } catch (error) { issues.push(`restore legacy docs failed: ${error.message}`); }
  try { if (existsSync(migrationRoot)) rmSync(migrationRoot, { recursive: true }); } catch (error) { issues.push(`remove migration marker failed: ${error.message}`); }
  try { if (!agentsExisted && existsSync(agents)) unlinkSync(agents); } catch (error) { issues.push(`remove generated AGENTS.md failed: ${error.message}`); }
  return issues;
}

export function migrate(root) {
  const canonicalRoot = rootPath(root);
  const docs = inside(canonicalRoot, 'docs');
  const migrationRoot = inside(canonicalRoot, '.sdd-migration');
  const legacy = inside(canonicalRoot, '.sdd-migration', 'legacy-docs');
  const agents = inside(canonicalRoot, 'AGENTS.md');
  return withProjectLock(canonicalRoot, () => {
    const agentsExisted = existsSync(agents);
    if (!existsSync(docs) || lstatSync(docs).isSymbolicLink() || !lstatSync(docs).isDirectory()) throw new Error('Legacy migration requires a real docs directory');
    if (isCanonicalDocs(docs)) throw new Error('Project already uses the canonical 01-09 docs layout');
    if (existsSync(migrationRoot)) throw new Error('.sdd-migration already exists; inspect the previous migration before retrying');
    mkdirSync(migrationRoot, { mode: 0o700 });
    try {
      renameSync(docs, legacy);
    } catch (error) {
      try { rmSync(migrationRoot, { recursive: true, force: true }); } catch { /* keep the original failure */ }
      throw error;
    }
    try {
      initializeUnlocked(canonicalRoot);
      const target = inside(canonicalRoot, 'docs', '01-governance', 'G02-migration-map.md');
      if (existsSync(target)) throw new Error('Canonical migration map path is already occupied');
      createText(target, migrationMap(legacy));
      refresh(path.dirname(target));
      return target;
    } catch (error) {
      const recovery = rollback(canonicalRoot, docs, migrationRoot, legacy, agents, agentsExisted);
      const suffix = recovery.length ? `; rollback incomplete: ${recovery.join('; ')}` : '';
      throw new Error(`${error.message}${suffix}`, { cause: error });
    }
  });
}

export async function runMigrateProject(argv, io = {}) {
  const args = parseArgs(argv, { options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh migrate-project [--root PROJECT]\n'); return 0; }
  if (args._.length) throw new UsageError(`unrecognized arguments: ${args._.join(' ')}`);
  writeLine(await migrate(args.root), io.stdout);
  return 0;
}
