#!/usr/bin/env node
import { runCommand, resolveRuntime, runtimeModuleUrl } from '../sdd-init/scripts/node_runtime.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const runtime = resolveRuntime(import.meta.url);
const manifest = JSON.parse(readFileSync(path.join(runtime.packageRoot, 'package.json'), 'utf8'));
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
  const { renderHelp } = await import(runtimeModuleUrl(import.meta.url, 'lib/cli/registry.js'));
  process.stdout.write(renderHelp(runtime.packageRoot, manifest.version));
} else if (argv[0] === '--version' || argv[0] === '-V') {
  process.stdout.write(`${manifest.version}\n`);
} else {
  process.exitCode = await runCommand(argv[0], argv.slice(1));
}
