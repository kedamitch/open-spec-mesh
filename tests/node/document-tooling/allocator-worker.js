import { existsSync } from 'node:fs';
import { createDocument } from '../../../lib/documents/create.js';

const [root, title, startFile] = process.argv.slice(2);
process.stdout.write('READY\n');
while (!existsSync(startFile)) await new Promise((resolve) => setTimeout(resolve, 2));
const target = await createDocument(root, 'docs/02-product', title);
process.stdout.write(`${target}\n`);
