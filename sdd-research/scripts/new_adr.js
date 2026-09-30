import { invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewAdr = (argv, io) => invokeRuntimeHandler('lib/documents/research.js', 'runNewAdr', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runNewAdr(process.argv.slice(2));
