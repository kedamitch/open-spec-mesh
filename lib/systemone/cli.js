import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { legacyJson, parseLosslessJson } from '../runtime/compat-json.js';
import { packageRoot as sourcePackageRoot } from './contracts.js';
import { Runtime, fallback } from './runtime.js';

const INPUT_LIMIT = 128 * 1024;

function usage() {
  return 'Usage: node mcp/laya_http_mcp.js [--input <json-file>]\n';
}

function parseArgs(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  if (argv.length === 2 && argv[0] === '--input' && argv[1]) return { input: argv[1] };
  if (argv.length === 1 && argv[0] === '--input') throw new TypeError('--input requires a JSON file path');
  if (argv.length) throw new TypeError('unsupported System One argument');
  return {};
}

export async function main({ argv = process.argv.slice(2), root = sourcePackageRoot(), configRoot = path.join(root, 'mcp'), stdin, stdout = process.stdout, stderr = process.stderr, runtime } = {}) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) {
    stderr.write(`${error.message}\n${usage()}`);
    return 2;
  }
  if (args.help) { stdout.write(usage()); return 0; }
  const instance = runtime ?? new Runtime({ root, configRoot });
  if (args.input !== undefined) {
    let result;
    try {
      const stat = statSync(args.input);
      if (!stat.isFile() || stat.size > INPUT_LIMIT) throw new TypeError('input too large or not a regular file');
      const body = parseLosslessJson(readFileSync(args.input, 'utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('input must be an object');
      const keys = Object.keys(body);
      if (keys.some((key) => !['decision', 'items', 'context', 'model'].includes(key))) throw new TypeError('unknown input field');
      result = await instance.run(body.decision, body.items, Object.hasOwn(body, 'context') ? body.context : null, Object.hasOwn(body, 'model') ? body.model : 'auto');
    } catch {
      result = fallback('invalid_input_file');
    }
    stdout.write(`${legacyJson(result, { ensureAscii: false, separators: [',', ':'] })}\n`);
    return 0;
  }
  try {
    const { runStdio } = await import('./mcp.js');
    await runStdio({ runtime: instance, stdin, stdout, stderr });
    return 0;
  } catch {
    stderr.write('System One MCP server failed to start.\n');
    return 1;
  }
}

// Match the public CLI registry's (argv, streams) handler contract. The registry's
// runtime is a package-location descriptor, not a System One Runtime instance.
export async function runSystemOne(argv = [], streams = {}) {
  return main({
    argv,
    root: streams.runtime?.packageRoot,
    stdin: streams.stdin,
    stdout: streams.stdout,
    stderr: streams.stderr,
  });
}
