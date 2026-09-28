import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SECRET = 'sk-DO-NOT-PERSIST-SYNTHETIC-SECRET';
export const envelope = (type, payload, second = 0, turn = 'turn-1') => ({
  type,
  timestamp: `2026-09-28T10:00:${String(second).padStart(2, '0')}Z`,
  payload,
});
export const baseRows = (id = 'root', extra = {}) => [
  envelope('session_meta', { id, cli_version: '0.155.1', base_instructions: SECRET, ...extra }),
  envelope('event_msg', { type: 'task_started', turn_id: 'turn-1' }, 1),
  envelope('turn_context', { turn_id: 'turn-1', model: 'gpt-test', effort: 'high' }, 2),
];
export async function writeRows(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return file;
}
export const endRow = (second = 50) => envelope('event_msg', { type: 'task_complete' }, second);
