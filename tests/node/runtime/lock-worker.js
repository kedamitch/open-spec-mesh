import { withProjectLock } from '../../../lib/runtime/locks.js';

const [root, pause = '1000'] = process.argv.slice(2);
await withProjectLock(root, async () => {
  process.stdout.write('LOCKED\n');
  await new Promise((resolve) => setTimeout(resolve, Number(pause)));
});
