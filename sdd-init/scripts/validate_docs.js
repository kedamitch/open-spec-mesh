import { invokeRuntimeHandler, isMain } from './node_runtime.js';

export const runValidateDocs = (argv, io) => invokeRuntimeHandler('lib/documents/validate.js', 'runValidateDocs', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runValidateDocs(process.argv.slice(2));
