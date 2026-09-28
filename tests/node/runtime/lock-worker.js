import { withProjectLock, withStoreLock } from '../../../lib/runtime/locks.js';

const [root, pause = '1000', namespace = 'project', mode = ''] = process.argv.slice(2);
const acquire = namespace === 'store' ? withStoreLock : withProjectLock;
if (mode === 'announce') process.stdout.write('CONTENDING\n');
await acquire(root, async () => {
  process.stdout.write('LOCKED\n');
  await new Promise((resolve) => setTimeout(resolve, Number(pause)));
});
