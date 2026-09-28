#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCheckRelease } from '../../lib/release/check-release.js';
export { runCheckRelease };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runCheckRelease(process.argv.slice(2));
