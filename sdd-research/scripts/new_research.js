import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewResearch = (argv, io) => invokeRuntimeHandler('lib/documents/research.js', 'runNewResearch', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('new-research');
