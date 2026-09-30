import { invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewChange = (argv, io) => invokeRuntimeHandler('lib/documents/change.js', 'runNewChange', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runNewChange(process.argv.slice(2));
