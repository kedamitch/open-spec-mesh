#!/usr/bin/env node
import { runEntry } from '../lib/cli/entry.js';

process.exitCode = await runEntry(process.argv.slice(2), { entryUrl: import.meta.url, short: true });
