import { invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewTask = (argv, io) => invokeRuntimeHandler('lib/documents/change.js', 'runNewTask', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runNewTask(process.argv.slice(2));
