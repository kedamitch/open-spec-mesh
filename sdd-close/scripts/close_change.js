import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runCloseChange = (argv, io) => invokeRuntimeHandler('lib/workflow/close-change.js', 'runCloseChange', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runSkillCommand('close-change');
