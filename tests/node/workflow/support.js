import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { graphSchema } from '../../../lib/runtime/graph-schema.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CHANGE_ID = 'CHG-20260928-nodejs-migration';
export const CHANGE_SOURCE = path.join(REPO_ROOT, 'docs/05-changes/C01-进行中', CHANGE_ID);
export const TASK_ID = 'C03-02';

export function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

export function commit(root, message = 'fixture') {
  git(root, 'add', '-A');
  git(root, 'commit', '-m', message, '--quiet');
  return git(root, 'rev-parse', 'HEAD');
}

export function makeRepo(t, { canonicalChange = true } = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'osm-workflow-test-'));
  const root = path.join(parent, 'project with spaces');
  mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'gc.auto', '0');
  git(root, 'config', 'maintenance.auto', 'false');
  git(root, 'config', 'user.name', 'Open Spec Mesh Test');
  git(root, 'config', 'user.email', 'osm-test@example.invalid');
  if (canonicalChange) {
    const target = path.join(root, 'docs/05-changes/C01-进行中', CHANGE_ID);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(CHANGE_SOURCE, target, { recursive: true });
    const graphPath = path.join(target, 'C03-tasks/C03-task-graph.json');
    const graph = graphSchema.load(graphPath);
    for (const task of graph.tasks) {
      task.state = 'planned';
      task.history = [];
      for (const key of ['result_revision', 'contract_digest', 'report_digest', 'workspace', 'baseline', 'attempt', 'agent_session']) delete task[key];
    }
    graphSchema.save(graphPath, graph);
    mkdirSync(path.join(root, 'docs/05-changes/C02-已完成'), { recursive: true });
    writeFileSync(path.join(root, 'docs/05-changes/C01-进行中/index.md'), '# Active Changes\n');
    writeFileSync(path.join(root, 'docs/05-changes/C02-已完成/index.md'), '# Completed Changes\n');
  } else {
    writeFileSync(path.join(root, 'README.md'), '# Isolated workflow fixture\n');
  }
  const base = commit(root, 'canonical fixture');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, base, change: path.join(root, 'docs/05-changes/C01-进行中', CHANGE_ID) };
}

export function writeValidationConfig(root, declaration) {
  const directory = path.join(root, 'docs/08-quality');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'Q01-validation.md'), `# Validation\n\n## Validation Entry Point\n\n\`${declaration}\`\n\n## Notes\n\nThe command is owned by this fixture.\n`, 'utf8');
}

export function taskPaths(change, taskId = TASK_ID) {
  const graph = graphSchema.load(path.join(change, 'C03-tasks/C03-task-graph.json'));
  const task = graph.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Missing fixture Task ${taskId}`);
  const directory = path.join(change, ...task.path.split('/'));
  return {
    graph,
    task,
    directory,
    taskIndex: path.join(directory, 'index.md'),
    taskContract: path.join(directory, 'C03-02-01-task.md'),
    taskReport: path.join(directory, 'C03-02-02-delivery.md'),
    graphPath: path.join(change, 'C03-tasks/C03-task-graph.json'),
  };
}
