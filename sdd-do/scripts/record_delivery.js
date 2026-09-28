#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runRecordDelivery } from '../../lib/workflow/record-delivery.js';
export { runRecordDelivery };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runRecordDelivery(process.argv.slice(2));
