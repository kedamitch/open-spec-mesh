#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNewRelease } from '../../lib/release/new-release.js';
export { runNewRelease };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runNewRelease(process.argv.slice(2));
