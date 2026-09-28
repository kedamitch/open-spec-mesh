import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('lib');
async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(file));
    else if (entry.isFile() && file.endsWith('.js')) found.push(file);
  }
  return found;
}

test('observation and diagnostics production modules cannot make network or subprocess calls', async () => {
  const files = [...await sourceFiles(path.join(root, 'observation')), ...await sourceFiles(path.join(root, 'diagnostics'))];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /node:(?:net|http|https|child_process|worker_threads)|from\s+['"](?:https?|node:child_process)['"]|\b(?:fetch|eval|execSync|spawnSync|fork)\s*\(/u, file);
  }
});
