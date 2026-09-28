#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runRecordAcceptance } from '../../lib/workflow/record-acceptance.js';
export { runRecordAcceptance };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runRecordAcceptance(process.argv.slice(2));
