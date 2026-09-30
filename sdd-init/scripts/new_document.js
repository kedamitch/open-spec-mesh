import { invokeRuntimeHandler, isMain } from './node_runtime.js';

export const runNewDocument = (argv, io) => invokeRuntimeHandler('lib/documents/create.js', 'runNewDocument', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runNewDocument(process.argv.slice(2));
