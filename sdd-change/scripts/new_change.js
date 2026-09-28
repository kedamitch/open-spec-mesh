import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewChange = (argv, io) => invokeRuntimeHandler('lib/documents/change.js', 'runNewChange', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('new-change');
