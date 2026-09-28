import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runLeafCommand } from '../../../lib/workflow/leaf.js';

const codexSession = '123e4567-e89b-12d3-a456-426614174000';

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function fakeHost(t, host) {
  const parent = mkdtempSync(path.join(os.tmpdir(), `osm-leaf-${host}-`));
  const bin = path.join(parent, 'bin');
  const root = path.join(parent, 'project with spaces');
  const hostHome = path.join(parent, 'host config with spaces');
  const recordPath = path.join(parent, 'invocation.json');
  const sentinel = path.join(parent, 'shell-was-used');
  mkdirSync(bin, { recursive: true });
  mkdirSync(root);
  mkdirSync(hostHome);

  const recorder = path.join(parent, 'fake-host.cjs');
  writeFileSync(recorder, `
const fs = require('node:fs');
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.OSM_FAKE_RECORD, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdin,
    env: {
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
      OPENCODE_CONFIG: process.env.OPENCODE_CONFIG,
    },
  }));
  process.stdout.write('fake stdout\\n');
  process.stderr.write('fake stderr\\n');
});
`, 'utf8');

  const executable = path.join(bin, host);
  writeFileSync(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(recorder)} "$@"\n`, 'utf8');
  chmodSync(executable, 0o755);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return {
    bin,
    root,
    hostHome,
    recordPath,
    sentinel,
    env: {
      ...process.env,
      PATH: [bin, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter),
      OSM_FAKE_RECORD: recordPath,
    },
  };
}

function recorded(pathname) {
  return JSON.parse(readFileSync(pathname, 'utf8'));
}

test('Codex leaf receives prompt on stdin, exact session, cwd, and no-agent permission overrides', (t) => {
  const fake = fakeHost(t, 'codex');
  const taskPrompt = `Task prompt with spaces; touch ${shellQuote(fake.sentinel)}; #`;
  const result = runLeafCommand('worker', {
    host: 'codex', root: fake.root, hostHome: fake.hostHome,
    prompt: taskPrompt, resume: codexSession, env: fake.env,
  });

  assert.equal(result.host, 'codex');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'fake stdout\n');
  assert.equal(result.stderr, 'fake stderr\n');
  const call = recorded(fake.recordPath);
  assert.equal(call.cwd, fake.root);
  assert.equal(call.stdin, taskPrompt);
  assert.ok(!call.argv.includes(taskPrompt), 'Codex prompt is not passed as a positional argument');
  assert.deepEqual(call.argv.slice(-6), [
    'exec', 'resume', codexSession, '--json', '--skip-git-repo-check', '-',
  ]);
  assert.equal(call.argv[call.argv.indexOf('-C') + 1], fake.root);

  const overrides = {};
  for (let i = 0; i < call.argv.length; i += 1) {
    if (call.argv[i] === '-c') {
      const [key, ...value] = call.argv[i + 1].split('=');
      overrides[key] = JSON.parse(value.join('='));
    }
  }
  assert.equal(overrides.model, 'gpt-6-luna');
  assert.equal(overrides.model_reasoning_effort, 'max');
  assert.equal(overrides.sandbox_mode, 'workspace-write');
  assert.equal(overrides['agents.enabled'], false);
  assert.equal(overrides['features.multi_agent'], false);
  assert.equal(overrides['features.multi_agent_v2'], false);
  assert.ok(overrides.developer_instructions.includes('不可委派任何 Agent'));
  assert.equal(existsSync(fake.sentinel), false);
});

test('OpenCode leaf appends prompt as one argv value and preserves session, cwd, and config overlay', (t) => {
  const fake = fakeHost(t, 'opencode');
  const session = 'session-abc_123';
  const taskPrompt = `Task prompt with spaces; touch ${shellQuote(fake.sentinel)}; #`;
  const result = runLeafCommand('explorer', {
    host: 'opencode', root: fake.root, hostHome: fake.hostHome,
    prompt: taskPrompt, resume: session, env: fake.env,
  });

  assert.equal(result.status, 0);
  const call = recorded(fake.recordPath);
  assert.equal(call.cwd, fake.root);
  assert.equal(call.stdin, '');
  assert.deepEqual(call.argv, [
    'run', '--agent', 'explorer', '--format', 'json', '--session', session, taskPrompt,
  ]);
  assert.equal(call.env.OPENCODE_CONFIG_DIR, fake.hostHome);
  assert.equal(call.env.OPENCODE_CONFIG, path.join(fake.hostHome, 'open-spec-mesh.opencode.json'));
  assert.equal(call.argv.at(-1), taskPrompt);
  assert.equal(existsSync(fake.sentinel), false);
});

test('Claude leaf appends prompt as one argv value and preserves session, cwd, and MCP overlay', (t) => {
  const fake = fakeHost(t, 'claude');
  const session = 'session-claude:123';
  const taskPrompt = `Task prompt with spaces; touch ${shellQuote(fake.sentinel)}; #`;
  const result = runLeafCommand('reviewer', {
    host: 'claude', root: fake.root, hostHome: fake.hostHome,
    prompt: taskPrompt, resume: session, env: fake.env,
  });

  assert.equal(result.status, 0);
  const call = recorded(fake.recordPath);
  assert.equal(call.cwd, fake.root);
  assert.equal(call.stdin, '');
  assert.deepEqual(call.argv, [
    '-p', '--agent', 'reviewer', '--output-format', 'stream-json', '--verbose',
    '--mcp-config', path.join(fake.hostHome, 'open-spec-mesh.mcp.json'),
    '--resume', session, taskPrompt,
  ]);
  assert.equal(call.argv.at(-1), taskPrompt);
  assert.equal(existsSync(fake.sentinel), false);
});
