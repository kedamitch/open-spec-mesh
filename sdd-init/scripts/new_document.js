import { runSkillCommand, invokeRuntimeHandler, isMain } from './node_runtime.js';

export const runNewDocument = (argv, io) => invokeRuntimeHandler('lib/documents/create.js', 'runNewDocument', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('new-document');
