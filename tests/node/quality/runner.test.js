import assert from 'node:assert/strict';
import test from 'node:test';
import { runChecks } from '../../../lib/validation/runner.js';

function stream() { return { text: '', write(value) { this.text += value; } }; }

test('required checks run serially, keep real output attached, and stop at the first failure', () => {
  const calls = [];
  const stdout = stream(); const stderr = stream();
  const exit = runChecks([
    { name: 'first', command: 'node', args: ['one'] },
    { name: 'second', command: 'node', args: ['two'] },
    { name: 'never', command: 'node', args: ['three'] },
  ], {
    cwd: '/fixture', env: { BASE: 'yes' }, stdout, stderr,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: args[0] === 'two' ? 7 : 0 };
    },
  });
  assert.equal(exit, 7);
  assert.deepEqual(calls.map(({ args }) => args[0]), ['one', 'two']);
  assert.equal(calls[0].options.cwd, '/fixture');
  assert.equal(calls[0].options.env.BASE, 'yes');
  assert.equal(calls[0].options.shell, false);
  assert.match(stdout.text, /== first ==[\s\S]*== second ==/u);
  assert.match(stderr.text, /FAILED second: exit=7/u);
  assert.doesNotMatch(stdout.text, /ALL REQUIRED CHECKS PASSED/u);
});

test('missing executable/startup errors and empty or malformed registries fail closed', () => {
  const stdout = stream(); const stderr = stream();
  assert.equal(runChecks([], { stdout, stderr }), 2);
  assert.match(stderr.text, /No required validation checks/u);
  assert.equal(runChecks([{ name: 'missing', command: 'definitely-not-a-program', args: [] }], {
    stdout: stream(), stderr: stream(), spawn: () => ({ error: new Error('ENOENT') }),
  }), 127);
  assert.equal(runChecks([{ name: 'bad', command: 'node', args: [2] }], {
    stdout: stream(), stderr: stream(), spawn: () => ({ status: 0 }),
  }), 2);
});

test('a complete required registry reports success only after every check returns zero', () => {
  const stdout = stream(); const stderr = stream();
  let calls = 0;
  assert.equal(runChecks([
    { name: 'syntax', command: 'node', args: ['--check', 'x.js'] },
    { name: 'tests', command: 'node', args: ['--test'] },
  ], { stdout, stderr, spawn: () => { calls += 1; return { status: 0 }; } }), 0);
  assert.equal(calls, 2);
  assert.match(stdout.text, /ALL REQUIRED CHECKS PASSED \(2\)/u);
  assert.equal(stderr.text, '');
});
