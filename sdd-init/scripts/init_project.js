import { invokeRuntimeHandler, isMain } from './node_runtime.js';

export const runInitProject = (argv, io) => invokeRuntimeHandler('lib/documents/init.js', 'runInitProject', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runInitProject(process.argv.slice(2));
