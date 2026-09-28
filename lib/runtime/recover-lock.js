import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { recoverLock } from './locks.js';
import { rootPath } from './paths.js';
import { parseArgs, UsageError } from '../cli/args.js';
import { writeJson } from '../cli/output.js';

export async function runRecoverLock(argv, io = {}) {
  const args = parseArgs(argv, {
    options: {
      root: { kind: 'value' },
      home: { kind: 'value' },
      db: { kind: 'value' },
      'owner-token': { kind: 'value' },
      'writers-stopped': { kind: 'boolean' },
    },
  });
  if (args.help) {
    (io.stdout ?? process.stdout).write('Usage: open-spec-mesh recover-lock (--root PROJECT | --home HOST_HOME | --db SQLITE_FILE) --owner-token TOKEN --writers-stopped\n');
    return 0;
  }
  if (args._.length) throw new UsageError(`unrecognized arguments: ${args._.join(' ')}`);
  const selected = [['project', args.root], ['install', args.home], ['store', args.db]].filter(([, value]) => value !== undefined);
  if (selected.length !== 1) throw new UsageError('Specify exactly one of --root, --home or --db.');
  if (!args['owner-token']) throw new UsageError('The following arguments are required: --owner-token');
  const [namespace, input] = selected[0];
  let target;
  if (namespace === 'project' || namespace === 'install') target = rootPath(input);
  else {
    target = path.resolve(input);
    const parent = realpathSync(path.dirname(target));
    target = path.join(parent, path.basename(target));
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('--db must identify a regular SQLite file');
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const result = recoverLock(namespace, target, args['owner-token'], { writersStopped: args['writers-stopped'] });
  writeJson(result, io.stdout);
  return 0;
}
