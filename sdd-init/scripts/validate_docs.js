import { runSkillCommand, invokeRuntimeHandler, isMain } from './node_runtime.js';

export const runValidateDocs = (argv, io) => invokeRuntimeHandler('lib/documents/validate.js', 'runValidateDocs', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('validate-docs');
