#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runValidation } from '../../lib/workflow/run-validation.js';
export { runValidation };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runValidation(process.argv.slice(2));
