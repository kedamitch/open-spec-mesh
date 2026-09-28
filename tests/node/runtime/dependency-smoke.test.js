import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import initSqlJs from 'sql.js';
import JSZip from 'jszip';
import { parse as parseToml } from 'smol-toml';
import { LosslessNumber, parse as parseLossless } from 'lossless-json';

const packageRoot = path.resolve('.');

test('the exact locked JS/WASM dependencies load without native or install-hook artifacts', async () => {
  const lock = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package-lock.json'), 'utf8'));
  const expected = {
    '@modelcontextprotocol/sdk': '1.30.1',
    'jszip': '3.10.2',
    'lossless-json': '4.3.1',
    'smol-toml': '1.4.2',
    'sql.js': '1.14.2',
  };
  for (const [name, version] of Object.entries(expected)) assert.equal(lock.packages[`node_modules/${name}`].version, version);
  const hooks = Object.entries(lock.packages).filter(([name, entry]) => name.startsWith('node_modules/') && entry.hasInstallScript).map(([name]) => name);
  assert.deepEqual(hooks, []);
  const nativeFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.node')) nativeFiles.push(file);
    }
  };
  visit(path.join(packageRoot, 'node_modules'));
  assert.deepEqual(nativeFiles, []);

  const sdk = await import('@modelcontextprotocol/sdk/server/index.js');
  assert.equal(typeof sdk.Server, 'function');
  const lossless = parseLossless('{"id":9007199254740993123}');
  assert.ok(lossless.id instanceof LosslessNumber);
  assert.equal(lossless.id.toString(), '9007199254740993123');
  const toml = parseToml('__proto__.polluted = true\nconstructor = "kept"\ncount = 9007199254740993', { integersAsBigInt: 'asNeeded' });
  assert.equal(Object.hasOwn(toml, '__proto__'), true);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(toml.count, 9007199254740993n);

  const zip = new JSZip();
  zip.file('smoke.txt', 'compiled JS');
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  assert.equal(await (await JSZip.loadAsync(archive)).file('smoke.txt').async('string'), 'compiled JS');

  const initializeSqlJs = initSqlJs.default ?? initSqlJs;
  const SQL = await initializeSqlJs({ locateFile: (filename) => path.join(packageRoot, 'node_modules/sql.js/dist', filename) });
  const database = new SQL.Database();
  assert.deepEqual(database.exec('SELECT 42 AS answer')[0].values[0], [42]);
  database.close();
  assert.ok(tmpdir());
});
