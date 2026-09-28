import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewAdr = (argv, io) => invokeRuntimeHandler('lib/documents/research.js', 'runNewAdr', argv, io);
if (isMain()) process.exitCode = await runSkillCommand('new-adr');
