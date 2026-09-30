import { invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewResearch = (argv, io) => invokeRuntimeHandler('lib/documents/research.js', 'runNewResearch', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runNewResearch(process.argv.slice(2));
