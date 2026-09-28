import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRuntime } from '../runtime/location.js';
import { UsageError } from './args.js';
import { writeError } from './output.js';

// This is the only public command-to-module map. Later Tasks may add the routed modules;
// absent implementations fail explicitly instead of behaving like successful stubs.
export const COMMAND_REGISTRY = Object.freeze({
  'init-project': ['sdd-init/scripts/init_project.js', 'runInitProject'],
  'migrate-project': ['sdd-migrate/scripts/migrate_project.js', 'runMigrateProject'],
  'new-document': ['sdd-init/scripts/new_document.js', 'runNewDocument'],
  'validate-docs': ['sdd-init/scripts/validate_docs.js', 'runValidateDocs'],
  'new-change': ['sdd-change/scripts/new_change.js', 'runNewChange'],
  'new-task': ['sdd-change/scripts/new_task.js', 'runNewTask'],
  'ensure-design': ['sdd-change/scripts/ensure_design.js', 'runEnsureDesign'],
  'new-research': ['sdd-research/scripts/new_research.js', 'runNewResearch'],
  'new-adr': ['sdd-research/scripts/new_adr.js', 'runNewAdr'],
  'sdd': ['lib/workflow/cli.js', 'runSdd'],
  'task-graph': ['lib/workflow/task-graph-cli.js', 'runTaskGraph'],
  'recover-lock': ['lib/runtime/recover-lock.js', 'runRecoverLock'],
  'prepare-workspace': ['lib/workflow/prepare-workspace.js', 'runPrepareWorkspace'],
  'record-delivery': ['lib/workflow/record-delivery.js', 'runRecordDelivery'],
  'record-acceptance': ['lib/workflow/record-acceptance.js', 'runRecordAcceptance'],
  'run-leaf': ['lib/workflow/run-leaf.js', 'runLeaf'],
  'check-change': ['lib/workflow/check-change.js', 'runCheckChange'],
  'close-change': ['lib/workflow/close-change.js', 'runCloseChange'],
  'run-validation': ['lib/workflow/run-validation.js', 'runValidation'],
  'new-release': ['lib/release/new-release.js', 'runNewRelease'],
  'check-release': ['lib/release/check-release.js', 'runCheckRelease'],
  'observe': ['lib/observation/cli.js', 'runObserve'],
  'diagnose': ['lib/diagnostics/cli.js', 'runDiagnose'],
  'systemone': ['lib/systemone/cli.js', 'runSystemOne'],
  'install': ['lib/installation/cli.js', 'runInstall'],
});

export function implementedCommands(packageRoot) {
  return Object.entries(COMMAND_REGISTRY)
    .filter(([name, [relative]]) => existsSync(path.join(packageRoot, relative)))
    .map(([name]) => name);
}

export function renderHelp(packageRoot, version) {
  const commands = implementedCommands(packageRoot);
  return [
    `open-spec-mesh ${version}`,
    '',
    'Usage: open-spec-mesh <command> [arguments]',
    '',
    'Available commands:',
    ...commands.map((command) => `  ${command}`),
    '',
  ].join('\n');
}

export async function runCommand(command, argv = [], streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  const route = COMMAND_REGISTRY[command];
  if (!route) {
    writeError(new UsageError(`Unknown command: ${command}`), stderr);
    return 2;
  }
  try {
    const runtime = resolveRuntime(import.meta.url);
    const modulePath = path.resolve(runtime.packageRoot, route[0]);
    const relative = path.relative(runtime.packageRoot, modulePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Invalid command route: ${command}`);
    if (!existsSync(modulePath)) throw new Error(`Command '${command}' is not available in this runtime (missing ${route[0]}).`);
    const module = await import(pathToFileURL(modulePath).href);
    const handler = module[route[1]];
    if (typeof handler !== 'function') throw new Error(`Command '${command}' has no registered handler.`);
    const result = await handler(argv, { ...streams, stdout, stderr, runtime });
    return Number.isInteger(result) ? result : 0;
  } catch (error) {
    writeError(error, stderr);
    return error instanceof UsageError ? error.exitCode : 1;
  }
}
