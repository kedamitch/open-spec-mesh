import { invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runMigrateProject = (argv, io) => invokeRuntimeHandler('lib/documents/migrate.js', 'runMigrateProject', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runMigrateProject(process.argv.slice(2));
