import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { legacyJson } from '../../../lib/runtime/compat-json.js';
import { changeSnapshot, loadReceipt, receiptPath, runValidation, validateReceipt, validationEntryPoint } from '../../../lib/workflow/receipt.js';
import { revision } from '../../../lib/workflow/contract.js';
import { CHANGE_ID, commit, makeRepo, writeValidationConfig } from './support.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t, scriptPath, scriptContent, declaration) {
  const project = makeRepo(t);
  const scripts = path.join(project.root, 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(path.join(project.root, 'package.json'), '{"name":"validation-fixture"}\n');
  writeFileSync(path.join(project.root, scriptPath), scriptContent, 'utf8');
  writeValidationConfig(project.root, declaration);
  project.base = commit(project.root, 'validation fixture');
  return project;
}

function runChild(script, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('legacy Python and Node script declarations preserve schema-1 descriptors', async (t) => {
  const py = fixture(t, 'scripts/legacy.py', 'print("legacy-python")\n', 'scripts/legacy.py');
  const pyEntry = validationEntryPoint(py.root);
  assert.equal(pyEntry.kind, 'python');
  assert.deepEqual(pyEntry.argv, ['python3', 'scripts/legacy.py']);
  assert.deepEqual(Object.keys(pyEntry.descriptor).sort(), ['path', 'sha256']);
  await runValidation(py.root, CHANGE_ID);
  const pyReceipt = loadReceipt(py.root, CHANGE_ID);
  assert.deepEqual(pyReceipt.entrypoint, pyEntry.descriptor);
  assert.deepEqual(Object.keys(pyReceipt.entrypoint).sort(), ['path', 'sha256']);
  assert.equal(pyReceipt.passed, true);
  const cliRun = await runChild(path.resolve('sdd-close/scripts/run_validation.js'), [CHANGE_ID, '--root', py.root], process.cwd());
  assert.equal(cliRun.code, 0, cliRun.stderr);

  const node = fixture(t, 'scripts/check.mjs', 'process.stdout.write("node-check\\n");\n', 'scripts/check.mjs');
  const nodeEntry = validationEntryPoint(node.root);
  assert.equal(nodeEntry.kind, 'node');
  assert.deepEqual(nodeEntry.argv, [process.execPath, 'scripts/check.mjs']);
  await runValidation(node.root, CHANGE_ID);
  const nodeReceipt = loadReceipt(node.root, CHANGE_ID);
  assert.deepEqual(nodeReceipt.entrypoint, nodeEntry.descriptor);
  assert.equal(nodeReceipt.passed, true);
});

test('explicit argv declaration is shell-free, tracked-path-bound, and stores only the legacy descriptor', async (t) => {
  const argv = [process.execPath, 'scripts/argv check.mjs', 'with spaces', '雪'];
  const declaration = JSON.stringify({ argv, path: 'package.json' });
  const project = fixture(t, 'scripts/argv check.mjs', 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n', declaration);
  const entry = validationEntryPoint(project.root);
  assert.equal(entry.kind, 'argv');
  assert.deepEqual(entry.argv, argv);
  const expected = sha(Buffer.concat([
    Buffer.from('\n---SDD-VALIDATION-ARGV-v1---\n', 'utf8'),
    Buffer.from(`${legacyJson(argv, { ensureAscii: false, sortKeys: true, separators: [',', ':'] })}\n`, 'utf8'),
    readFileSync(path.join(project.root, 'package.json')),
  ]));
  assert.equal(entry.descriptor.sha256, expected);
  await runValidation(project.root, CHANGE_ID);
  const file = receiptPath(project.root, CHANGE_ID);
  const rawReceipt = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(rawReceipt.entrypoint, { path: 'package.json', sha256: expected });
  assert.deepEqual(Object.keys(rawReceipt.entrypoint).sort(), ['path', 'sha256']);
  assert.equal(rawReceipt.passed, true);
});

test('schema-1 legacy descriptor validation ignores object key order but rejects extra fields', async (t) => {
  const project = fixture(t, 'scripts/legacy.js', 'process.exit(0);\n', 'scripts/legacy.js');
  await runValidation(project.root, CHANGE_ID);
  const file = receiptPath(project.root, CHANGE_ID);
  const receipt = JSON.parse(readFileSync(file, 'utf8'));
  receipt.entrypoint = { sha256: receipt.entrypoint.sha256, path: receipt.entrypoint.path };
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.equal(validateReceipt(project.root, CHANGE_ID, revision(project.root, 'HEAD')).passed, true);
  receipt.entrypoint.argv = [process.execPath, 'scripts/legacy.js'];
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.throws(() => validateReceipt(project.root, CHANGE_ID, revision(project.root, 'HEAD')), /receipt mismatch: entrypoint/u);
});

test('failed command startup and unstable Change snapshots leave failed receipts', async (t) => {
  const missing = fixture(t, 'scripts/marker.js', 'process.exit(0);\n', JSON.stringify({ argv: ['/no/such/open-spec-mesh-command', 'arg'], path: 'package.json' }));
  await assert.rejects(runValidation(missing.root, CHANGE_ID), /could not start/u);
  const failedStart = loadReceipt(missing.root, CHANGE_ID);
  assert.equal(failedStart.passed, false);
  assert.equal(failedStart.exit_code, null);
  assert.deepEqual(Object.keys(failedStart.entrypoint).sort(), ['path', 'sha256']);

  const unstable = fixture(t, 'scripts/make-link.js', '', 'scripts/make-link.js');
  const link = path.join(unstable.change, '.created-during-validation');
  writeFileSync(path.join(unstable.root, 'scripts/make-link.js'), `import { symlinkSync } from 'node:fs';\nsymlinkSync('missing-target', ${JSON.stringify(link)});\n`);
  commit(unstable.root, 'install unstable validation command');
  await assert.rejects(runValidation(unstable.root, CHANGE_ID), /changed the validated revision or project artifacts/u);
  const failedSnapshot = loadReceipt(unstable.root, CHANGE_ID);
  assert.equal(failedSnapshot.passed, false);
  assert.equal(failedSnapshot.exit_code, 0);
});

test('concurrent validation runs serialize receipt writes with the shared store lock', async (t) => {
  const project = fixture(t, 'scripts/slow.js', 'await new Promise((resolve) => setTimeout(resolve, 120));\n', 'scripts/slow.js');
  const runner = path.resolve('sdd-close/scripts/run_validation.js');
  const [first, second] = await Promise.all([
    runChild(runner, [CHANGE_ID, '--root', project.root], process.cwd()),
    runChild(runner, [CHANGE_ID, '--root', project.root], process.cwd()),
  ]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(loadReceipt(project.root, CHANGE_ID).passed, true);
});

test('snapshot hashing is stable and sorted across filesystem enumeration order', (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), 'osm-change-snapshot-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const change = path.join(temp, 'active-change');
  mkdirSync(change);
  const directory = path.join(change, 'snapshot');
  mkdirSync(directory);
  writeFileSync(path.join(directory, 'z.txt'), 'z');
  writeFileSync(path.join(directory, 'a.txt'), 'a');
  const executable = path.join(directory, 'exec.js');
  writeFileSync(executable, 'exec');
  chmodSync(executable, 0o751);
  const files = [
    ['snapshot/a.txt', Buffer.from('a')],
    ['snapshot/exec.js', Buffer.from('exec')],
    ['snapshot/z.txt', Buffer.from('z')],
  ];
  const expected = createHash('sha256');
  for (const [name, bytes] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const length = (value) => { const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(value)); return buffer; };
    expected.update(length(nameBytes.length)).update(nameBytes).update(length(bytes.length)).update(bytes);
  }
  assert.equal(changeSnapshot(change), expected.digest('hex'));
});
