import { existsSync, mkdirSync, rmSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { resolveRuntime } from '../runtime/location.js';
import { createText, atomicWrite } from '../runtime/io.js';
import { readTextCompat } from '../runtime/text.js';
import { rootPath, inside, activeChange, renderSpec, today } from './common.js';
import { allocate, titleCheck, refresh, withProjectLock } from './numbering.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine } from '../cli/output.js';

const runtime = resolveRuntime(import.meta.url);
const template = (skill, name) => readTextCompat(path.join(runtime.resourceRoot, skill, 'references', name));
function existsDirectory(p) {
  try { const s = lstatSync(p); return s.isDirectory() && !s.isSymbolicLink(); }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

export function createChange(root, title) {
  titleCheck(title);
  const canonical = rootPath(root);
  return withProjectLock(canonical, () => {
    const id = `CHG-${today().replaceAll('-', '')}-${title}`;
    const active = inside(canonical, 'docs', '05-changes', 'C01-进行中');
    if (!existsDirectory(active)) throw new Error('Run init-project first');
    const dir = inside(canonical, path.relative(canonical, active), id);
    if (existsSync(dir) || existsSync(inside(canonical, 'docs/05-changes/C02-已完成', id))) throw new Error('Change already exists');
    const text = template('sdd-req', 'change-template.md');
    mkdirSync(dir);
    try {
      createText(path.join(dir, 'C01-change.md'), text);
      createText(path.join(dir, 'index.md'), renderSpec({ id, created: today(), contract: 'C01-change.md' }, `\n# ${title}\n`));
      refresh(dir); refresh(active);
      return dir;
    } catch (e) {
      rmSync(dir, { recursive: true, force: true }); refresh(active); throw e;
    }
  });
}

export function ensureDesign(root, changeId) {
  const canonical = rootPath(root);
  return withProjectLock(canonical, () => {
    const [dir] = activeChange(canonical, changeId);
    const file = inside(canonical, path.relative(canonical, dir), 'C02-design.md');
    if (!existsSync(file)) createText(file, template('sdd-design', 'design-template.md'));
    else readTextCompat(file);
    refresh(dir);
    return file;
  });
}

export function createTask(root, changeId, title, dependencies = []) {
  titleCheck(title);
  if (!Array.isArray(dependencies) || dependencies.some((x) => typeof x !== 'string' || !/^C03-\d{2}$/u.test(x))) throw new Error('Dependencies must be C03-xx task IDs');
  const canonical = rootPath(root);
  return withProjectLock(canonical, () => {
    const [change] = activeChange(canonical, changeId);
    const tasks = inside(canonical, path.relative(canonical, change), 'C03-tasks');
    const newRoot = !existsSync(tasks);
    if (newRoot) mkdirSync(tasks);
    if (!existsDirectory(tasks)) throw new Error('Task directory must be a real directory');
    const plan = path.join(tasks, 'C03-task-plan.md');
    const oldPlan = existsSync(plan) ? readTextCompat(plan) : null;
    let dir;
    try {
      dir = allocate(canonical, tasks, title, { directory: true });
      const id = path.basename(dir).slice(0, -title.length - 1);
      const text = template('sdd-plan', 'task-design-template.md')
        .replaceAll('TASK_ID', id).replaceAll('TITLE', title)
        .replaceAll('DESIGN_PATH', '../../C02-design.md')
        .replaceAll('DEPENDENCIES', [...new Set(dependencies)].join(', ') || '无');
      createText(path.join(dir, `${id}-01-task.md`), text);
      const row = `- [${id}｜${title}](${path.basename(dir)}/${id}-01-task.md)；依赖：${[...new Set(dependencies)].join(', ') || '无'}。\n`;
      const base = oldPlan ?? template('sdd-plan', 'execution-plan-template.md');
      atomicWrite(plan, Buffer.from(base.trimEnd() + '\n\n' + row, 'utf8'), { preserveMode: true });
      refresh(dir); refresh(tasks); refresh(change);
      return dir;
    } catch (e) {
      if (dir) rmSync(dir, { recursive: true, force: true });
      if (oldPlan !== null) atomicWrite(plan, Buffer.from(oldPlan, 'utf8'), { preserveMode: true });
      else rmSync(plan, { force: true });
      if (newRoot) rmSync(tasks, { recursive: true, force: true });
      else refresh(tasks);
      refresh(change); throw e;
    }
  });
}

export async function runNewChange(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['title'], options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh new-change TITLE [--root PROJECT]\n'); return 0; }
  writeLine(await createChange(args.root, args.title), io.stdout); return 0;
}
export async function runNewTask(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['change_id', 'title'], options: { 'depends-on': { kind: 'multiple', default: [] }, root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh new-task CHANGE_ID TITLE [--depends-on TASK_ID ...] [--root PROJECT]\n'); return 0; }
  writeLine(await createTask(args.root, args.change_id, args.title, args['depends-on']), io.stdout); return 0;
}
export async function runEnsureDesign(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['change_id'], options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh ensure-design CHANGE_ID [--root PROJECT]\n'); return 0; }
  writeLine(await ensureDesign(args.root, args.change_id), io.stdout); return 0;
}
