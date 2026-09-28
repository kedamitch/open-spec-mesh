#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPrepareWorkspace } from '../../lib/workflow/prepare-workspace.js';
export { runPrepareWorkspace };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runPrepareWorkspace(process.argv.slice(2));
