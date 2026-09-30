import { invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runEnsureDesign = (argv, io) => invokeRuntimeHandler('lib/documents/change.js', 'runEnsureDesign', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runEnsureDesign(process.argv.slice(2));
