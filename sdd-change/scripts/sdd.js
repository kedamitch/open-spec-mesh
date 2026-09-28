#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSdd } from '../../lib/workflow/cli.js';
export { runSdd };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runSdd(process.argv.slice(2));
