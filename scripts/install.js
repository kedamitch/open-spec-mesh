#!/usr/bin/env node
import { runInstall } from '../lib/installation/cli.js';

process.exitCode = await runInstall(process.argv.slice(2));
