import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runEnsureDesign = (argv, io) => invokeRuntimeHandler('lib/documents/change.js', 'runEnsureDesign', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('ensure-design');
