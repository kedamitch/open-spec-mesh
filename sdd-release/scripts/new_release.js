import { runSkillCommand, invokeRuntimeHandler, isMain } from '../../sdd-init/scripts/node_runtime.js';

export const runNewRelease = (argv, io) => invokeRuntimeHandler('lib/release/new-release.js', 'runNewRelease', argv, io);
if (isMain(import.meta.url)) process.exitCode = await runSkillCommand('new-release');
