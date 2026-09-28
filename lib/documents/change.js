import { existsSync, mkdirSync, rmSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { resolveRuntime } from '../runtime/location.js';
import { createText, atomicWrite } from '../runtime/io.js';
import { readTextCompat } from '../runtime/text.js';
import { graphSchema } from '../runtime/graph-schema.js';
import { rootPath, inside, activeChange, mappedDocument, renderSpec, today } from './common.js';
import { allocate, titleCheck, refresh, withProjectLock } from './numbering.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeLine } from '../cli/output.js';

const runtime = resolveRuntime(import.meta.url);
const changeReferences = path.join(runtime.resourceRoot, 'sdd-change/references');

function template(name) {
  return readTextCompat(path.join(changeReferences, name));
}

export function createChange(root, title) {
  titleCheck(title);
  const canonicalRoot = rootPath(root);
  return withProjectLock(canonicalRoot, () => {
    const changeId = `CHG-${today().replaceAll('-', '')}-${title}`;
    const active = inside(canonicalRoot, 'docs', '05-changes', 'C01-进行中');
    if (!existsDirectory(active)) throw new Error('Run sdd-init first');
    const completed = inside(canonicalRoot, 'docs', '05-changes', 'C02-已完成', changeId);
    if (existsSync(completed)) throw new Error('Change already completed');
    const change = inside(canonicalRoot, path.relative(canonicalRoot, active), changeId);
    if (existsSync(change)) throw new Error(`Change already exists: ${changeId}`);
    const contractTemplate = template('change-template.md');
    const designTemplate = template('design-template.md');
    mkdirSync(change);
    try {
      createText(path.join(change, 'index.md'), `# ${title}\n`);
      const currentDate = today();
      const fields = { id: changeId, status: 'active', created: currentDate, updated: currentDate };
      fields.contract = path.basename(allocate(canonicalRoot, change, 'change', { content: contractTemplate }));
      fields.design = path.basename(allocate(canonicalRoot, change, 'design', { content: designTemplate }));
      const tasks = allocate(canonicalRoot, change, 'tasks', { directory: true });
      fields.tasks = path.basename(tasks);
      const graphName = `${path.basename(tasks).split('-tasks', 1)[0]}-task-graph.json`;
      createText(path.join(tasks, graphName), '{"tasks": []}\n');
      fields.graph = `${fields.tasks}/${graphName}`;
      atomicWrite(path.join(change, 'index.md'), Buffer.from(renderSpec(fields, `\n# ${title}\n`), 'utf8'), { preserveMode: true });
      refresh(tasks);
      refresh(change);
      refresh(active);
      return change;
    } catch (error) {
      try { rmSync(change, { recursive: true, force: true }); refresh(active); } catch { /* Preserve original failure and any recovery evidence. */ }
      throw error;
    }
  });
}

function existsDirectory(pathname) {
  try { const stat = lstatSync(pathname); return stat.isDirectory() && !stat.isSymbolicLink(); }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

export function createTask(root, changeId, title, dependencies = []) {
  titleCheck(title);
  if (!Array.isArray(dependencies) || new Set(dependencies).size !== dependencies.length) throw new Error('Duplicate dependencies');
  const canonicalRoot = rootPath(root);
  return withProjectLock(canonicalRoot, () => {
    const [change, fields, body] = activeChange(canonicalRoot, changeId);
    if (!['contract', 'design', 'tasks', 'graph'].every((key) => Object.hasOwn(fields, key))) throw new Error('Change does not use the canonical C01/C02/C03 layout');
    const graphPath = mappedDocument(canonicalRoot, change, fields, 'graph');
    const graph = graphSchema.load(graphPath);
    const known = new Set(graph.tasks.map((task) => task.id));
    if (dependencies.some((dependency) => !known.has(dependency))) throw new Error('Unknown dependency');
    const taskRoot = inside(canonicalRoot, path.relative(canonicalRoot, change), fields.tasks);
    if (!existsDirectory(taskRoot)) throw new Error('Canonical Task directory missing: C03-tasks');
    const design = mappedDocument(canonicalRoot, change, fields, 'design');
    const taskTemplate = readTextCompat(path.join(runtime.resourceRoot, 'sdd-change/references/sdd-task-contract-template.md'));
    const dependencyCheck = [...dependencies];
    if (dependencyCheck.some((dependency) => typeof dependency !== 'string')) throw new Error('Dependencies must be task IDs');

    let directory = null;
    let graphCommitted = false;
    const originalGraph = graph.tasks.slice();
    try {
      directory = allocate(canonicalRoot, taskRoot, title, { directory: true });
      const taskId = path.basename(directory).slice(0, -(`-${title}`).length);
      const designPath = path.relative(directory, design).split(path.sep).join('/');
      const contract = taskTemplate.replaceAll('DESIGN_PATH', designPath).replaceAll('TASK_ID', taskId);
      const taskFields = { id: taskId };
      taskFields.contract = path.basename(allocate(canonicalRoot, directory, 'task', { content: contract }));
      taskFields.report = path.basename(allocate(canonicalRoot, directory, 'delivery', {
        content: '# Task Delivery\n\n尚未交付。Worker 完成实现、验证和自审后写入。\n',
      }));
      atomicWrite(path.join(directory, 'index.md'), Buffer.from(renderSpec(taskFields, `\n# ${title}\n`), 'utf8'), { preserveMode: true });
      refresh(directory);
      graph.tasks.push({ id: taskId, path: path.relative(change, directory).split(path.sep).join('/'), depends_on: dependencies, state: 'planned', history: [] });
      graphSchema.validate(graph);
      graphSchema.save(graphPath, graph);
      graphCommitted = true;
      fields.updated = fields.updated ?? '';
      atomicWrite(path.join(change, 'index.md'), Buffer.from(renderSpec(fields, body), 'utf8'), { preserveMode: true });
      refresh(taskRoot);
      refresh(change);
      return directory;
    } catch (error) {
      const recovery = [];
      if (graphCommitted) {
        try { graph.tasks = originalGraph; graphSchema.save(graphPath, graph); }
        catch (rollbackError) { recovery.push(`graph rollback failed at ${graphPath}: ${rollbackError.message}`); }
      }
      if (directory && recovery.length === 0) {
        try { rmSync(directory, { recursive: true, force: true }); refresh(taskRoot); refresh(change); }
        catch (rollbackError) { recovery.push(`task rollback incomplete at ${directory}: ${rollbackError.message}`); }
      }
      throw recovery.length ? new Error(`${error.message}; ${recovery.join('; ')}`, { cause: error }) : error;
    }
  });
}

export function ensureDesign(root, changeId) {
  const canonicalRoot = rootPath(root);
  const [change, fields] = activeChange(canonicalRoot, changeId);
  const design = mappedDocument(canonicalRoot, change, fields, 'design');
  if (path.basename(design) !== 'C02-design.md') throw new Error('Canonical Design must be C02-design.md');
  return design;
}

export async function runNewChange(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['title'], options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh new-change TITLE [--root PROJECT]\n'); return 0; }
  writeLine(await createChange(args.root, args.title), io.stdout);
  return 0;
}

export async function runNewTask(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['change_id', 'title'], options: { 'depends-on': { kind: 'multiple', default: [] }, root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh new-task CHANGE_ID TITLE [--depends-on TASK_ID ...] [--root PROJECT]\n'); return 0; }
  writeLine(await createTask(args.root, args.change_id, args.title, args['depends-on']), io.stdout);
  return 0;
}

export async function runEnsureDesign(argv, io = {}) {
  const args = parseArgs(argv, { positionals: ['change_id'], options: { root: { kind: 'value', default: process.cwd() } } });
  if (args.help) { (io.stdout ?? process.stdout).write('Usage: open-spec-mesh ensure-design CHANGE_ID [--root PROJECT]\n'); return 0; }
  writeLine(ensureDesign(args.root, args.change_id), io.stdout);
  return 0;
}
