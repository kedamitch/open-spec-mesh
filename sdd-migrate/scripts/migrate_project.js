import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runMigrateProject = (argv, io) => invokeRuntimeHandler('lib/documents/migrate.js', 'runMigrateProject', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('migrate-project');
