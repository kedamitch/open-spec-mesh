import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewTask = (argv, io) => invokeRuntimeHandler('lib/documents/change.js', 'runNewTask', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('new-task');
