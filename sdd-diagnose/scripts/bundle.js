#!/usr/bin/env node
import { isMain, runSkillCommand } from '../../sdd-init/scripts/node_runtime.js';

export async function main(argv = process.argv.slice(2), streams = {}) {
  return runSkillCommand('diagnose', argv, streams);
}

if (isMain(import.meta.url)) process.exitCode = await main();
