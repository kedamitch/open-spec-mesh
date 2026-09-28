import { runSkillCommand, invokeRuntimeHandler, isMain } from './node_runtime.js';

export const runInitProject = (argv, io) => invokeRuntimeHandler('lib/documents/init.js', 'runInitProject', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('init-project');
