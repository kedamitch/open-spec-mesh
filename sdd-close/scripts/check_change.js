#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCheckChange } from '../../lib/workflow/check-change.js';
export { runCheckChange };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runCheckChange(process.argv.slice(2));
