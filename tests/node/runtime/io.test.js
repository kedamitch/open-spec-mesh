import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicWrite } from '../../../lib/runtime/io.js';
import { safePath } from '../../../lib/installation/tools.js';

// `link` spells `real` through a symlink, so every descendant of `link` carries a
// symlinked ancestor: the shape macOS os.tmpdir() has (/var -> /private/var).
function fixture(t) {
  const base = mkdtempSync(path.join(realpathSync(tmpdir()), 'osm-io-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  mkdirSync(path.join(real, 'nested'), { recursive: true });
  const link = path.join(base, 'link');
  symlinkSync(real, link, 'dir');
  return { base, real, link };
}

test('atomicWrite resolves a symlinked ancestor and writes the real directory', (t) => {
  const { base, real, link } = fixture(t);
  const target = path.join(link, 'nested', 'state.json');
  atomicWrite(target, Buffer.from('through link\n'));
  assert.equal(readFileSync(path.join(real, 'nested', 'state.json'), 'utf8'), 'through link\n');
  assert.equal(statSync(path.join(real, 'nested', 'state.json')).mode & 0o777, 0o600);
  assert.equal(lstatSync(target).isSymbolicLink(), false);
  assert.deepEqual(readdirSync(path.join(real, 'nested')), ['state.json']);
  assert.deepEqual(readdirSync(base).sort(), ['link', 'real']);
});

test('atomicWrite preserves an existing mode reached through a symlinked ancestor', (t) => {
  const { real, link } = fixture(t);
  const stored = path.join(real, 'nested', 'snapshot.json');
  writeFileSync(stored, 'old');
  chmodSync(stored, 0o640);
  atomicWrite(path.join(link, 'nested', 'snapshot.json'), Buffer.from('new\n'), { preserveMode: true });
  assert.equal(readFileSync(stored, 'utf8'), 'new\n');
  assert.equal(statSync(stored).mode & 0o777, 0o640);
});

test('atomicWrite refuses a symlinked target and leaves its bytes untouched', (t) => {
  const { real, link } = fixture(t);
  const outside = path.join(real, 'outside.txt');
  writeFileSync(outside, 'keep');
  symlinkSync(outside, path.join(real, 'nested', 'alias.json'));
  const target = path.join(link, 'nested', 'alias.json');
  assert.throws(() => atomicWrite(target, Buffer.from('bytes')), { message: `Refusing symlink: ${target}` });
  assert.equal(readFileSync(outside, 'utf8'), 'keep');
  assert.deepEqual(readdirSync(path.join(real, 'nested')), ['alias.json']);
});

test('atomicWrite refuses a symlinked or non-directory direct parent', (t) => {
  const { base, real } = fixture(t);
  const parentLink = path.join(real, 'parent-link');
  symlinkSync(path.join(real, 'nested'), parentLink, 'dir');
  assert.throws(() => atomicWrite(path.join(parentLink, 'child.json'), Buffer.from('bytes')), { message: `Refusing unsafe parent directory: ${parentLink}` });
  const asFile = path.join(real, 'nested', 'file.json');
  writeFileSync(asFile, 'file');
  assert.throws(() => atomicWrite(path.join(asFile, 'child.json'), Buffer.from('bytes')), { message: `Refusing unsafe parent directory: ${asFile}` });
  assert.deepEqual(readdirSync(base).sort(), ['link', 'real']);
  assert.deepEqual(readdirSync(real).sort(), ['nested', 'parent-link']);
});

test('safePath accepts symlinked ancestors and keeps both refusals', (t) => {
  const { real, link } = fixture(t);
  safePath(path.join(link, 'nested', 'state.json'));
  safePath(path.join(link, 'missing', 'deep', 'manifest.toml'));
  atomicWrite(path.join(link, 'nested', 'state.json'), Buffer.from('ok\n'));
  assert.equal(readFileSync(path.join(real, 'nested', 'state.json'), 'utf8'), 'ok\n');
  const outside = path.join(real, 'outside.txt');
  writeFileSync(outside, 'keep');
  symlinkSync(outside, path.join(real, 'nested', 'alias.json'));
  const alias = path.join(link, 'nested', 'alias.json');
  assert.throws(() => safePath(alias), { message: `Refusing symlink: ${alias}` });
  const parentLink = path.join(real, 'parent-link');
  symlinkSync(path.join(real, 'nested'), parentLink, 'dir');
  assert.throws(() => safePath(path.join(parentLink, 'child.json')), { message: `Refusing symlink: ${parentLink}` });
});
