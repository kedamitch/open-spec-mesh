import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { INSTALL_INTERNALS, installHost, parseInstallArgs } from '../../../lib/installation/installer.js';
import { RUNTIME_INTERNALS } from '../../../lib/installation/runtime-stage.js';
import { parseToml } from '../../../lib/installation/toml.js';
import { REPO_ROOT, memoryStreams, tempDirectory } from './helpers.js';

const tools = { codegraph: 'codegraph', context7: 'context7-mcp', tavily: 'tavily-mcp' };
const packageFiles = RUNTIME_INTERNALS.packageFiles(REPO_ROOT, JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')));

test('install flags preserve defaults, precedence, and mutual exclusion', () => {
  const defaults = parseInstallArgs([]);
  assert.equal(defaults.host, 'codex');
  assert.equal(defaults.dryRun, false);
  assert.equal(defaults.skipTools, false);
  const parsed = parseInstallArgs(['--host', 'claude', '--host-home', '/tmp/custom home', '--codex-home', '/tmp/ignored', '--dry-run', '--skip-tools', '--include-project-docs', '--with-laya']);
  assert.equal(parsed.home, path.resolve('/tmp/custom home'));
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.skipTools, true);
  assert.equal(parsed.includeProjectDocs, true);
  assert.equal(parsed.withLaya, true);
  assert.throws(() => parseInstallArgs(['--with-laya', '--without-laya']), /mutually exclusive/);
  assert.throws(() => parseInstallArgs(['--host-home']), /requires a value/);
  assert.deepEqual(parseInstallArgs(['--help']), { help: true });
});

test('dry-run reports the plan without creating Home, lock, npm stage, or configuration', async (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'not-created', 'codex');
  const report = [];
  const result = await installHost({
    source: REPO_ROOT, home, host: 'codex', dryRun: true, skipTools: true,
    nodeVersion: '24.21.0', env: { PATH: process.env.PATH ?? '' }, reporter: (line) => report.push(line),
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(existsSync(home), false);
  assert.equal(report.some((line) => line.includes('dry-run: no target files changed')), true);
  assert.equal(report.some((line) => line.includes('SYSTEM ONE')), true);
});

test('initial Codex default-off plan does not publish baseline Python or Node bridge assets', async (t) => {
  const root = tempDirectory(t); const hostStage = path.join(root, 'stage'); mkdirSync(hostStage);
  const result = await INSTALL_INTERNALS.buildHostStage({
    source: REPO_ROOT, home: path.join(root, 'codex'), host: 'codex', hostStage, runtimeRoot: REPO_ROOT,
    runtimeFiles: packageFiles, toolCommands: tools, layaManaged: true, effectiveLaya: false,
    withLaya: false, includeProjectDocs: false, codexText: readFileSync(path.join(REPO_ROOT, 'config.toml'), 'utf8'),
    codexConfigExisted: false, previousLaya: undefined, previousHost: new Set(),
  });
  assert.equal(result.operations.some((item) => item.relative.startsWith('mcp/laya-')), false);
  const configFile = path.join(hostStage, 'config.toml');
  assert.equal(existsSync(configFile), true);
  const config = parseToml(readFileSync(configFile, 'utf8'));
  assert.equal(Object.hasOwn(config.mcp_servers ?? {}, 'laya'), false);
});

test('owned legacy Python bridge upgrades to disabled Node runtime without enabling Laya', async (t) => {
  const root = tempDirectory(t); const hostStage = path.join(root, 'stage'); mkdirSync(hostStage);
  const home = path.join(root, 'codex'); mkdirSync(home);
  const oldText = readFileSync(path.join(REPO_ROOT, 'tests/fixtures/migration/installation/legacy-python-bridge.toml'), 'utf8');
  const oldConfig = parseToml(oldText).mcp_servers.laya;
  const result = await INSTALL_INTERNALS.buildHostStage({
    source: REPO_ROOT, home, host: 'codex', hostStage, runtimeRoot: REPO_ROOT, runtimeFiles: packageFiles,
    toolCommands: tools, layaManaged: true, effectiveLaya: false, withLaya: false, includeProjectDocs: false,
    codexText: oldText, codexConfigExisted: true, previousLaya: oldConfig,
    previousHost: new Set(['open-spec-mesh/runtime', 'mcp/laya_http_mcp.js', 'mcp/laya-settings.json']),
  });
  assert.equal(result.operations.some((item) => item.relative === 'mcp/laya_http_mcp.js'), true);
  assert.equal(result.operations.some((item) => item.relative === 'mcp/laya-settings.json'), true);
  assert.equal(existsSync(path.join(hostStage, 'mcp/laya_http_mcp.js')), true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(hostStage, 'mcp/laya-settings.json'), 'utf8')), { enabled: false });
  const parsed = parseToml(readFileSync(path.join(hostStage, 'config.toml'), 'utf8'));
  assert.equal(parsed.mcp_servers.laya.command, process.execPath);
  assert.equal(parsed.mcp_servers.laya.args[0], path.join(home, 'mcp/laya_http_mcp.js'));
  assert.equal(parsed.mcp_servers.laya.enabled, false);
});

test('OpenCode and Claude render independent native layouts and preserve source host configs', async (t) => {
  const root = tempDirectory(t);
  for (const host of ['opencode', 'claude']) {
    const home = path.join(root, host); const hostStage = path.join(root, `${host}-stage`); mkdirSync(hostStage);
    const profile = await import('../../../lib/installation/host-adapter.js').then((module) => module.hostProfile(host, home));
    const result = await INSTALL_INTERNALS.buildHostStage({
      source: REPO_ROOT, home, host, hostStage, runtimeRoot: REPO_ROOT, runtimeFiles: packageFiles,
      toolCommands: tools, layaManaged: true, effectiveLaya: false, withLaya: false, includeProjectDocs: false,
      codexText: '', codexConfigExisted: false, previousLaya: undefined, previousHost: new Set(),
    });
    assert.equal(existsSync(path.join(hostStage, profile.mcpOverlay)), true);
    assert.equal(result.managedPaths.has(profile.mcpOverlay), true);
    const overlay = JSON.parse(readFileSync(path.join(hostStage, profile.mcpOverlay), 'utf8'));
    assert.equal(Boolean(overlay.mcp?.servers?.laya || overlay.mcpServers?.laya), false);
    assert.equal(existsSync(path.join(hostStage, 'agents/main.md')), true);
    assert.equal(existsSync(path.join(home, profile.mcpOverlay)), false);
  }
});

test('custom Laya configuration is not interpreted as managed or changed by with-laya', async (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'codex'); mkdirSync(home);
  const custom = '[mcp_servers.laya]\nurl = "https://custom.invalid/mcp"\nheaders = { Authorization = "env:USER_TOKEN" }\n';
  writeFileSync(path.join(home, 'config.toml'), custom);
  const report = [];
  await installHost({
    source: REPO_ROOT, home, host: 'codex', dryRun: true, skipTools: true, withLaya: true,
    nodeVersion: '24.21.0', env: { PATH: process.env.PATH ?? '' }, reporter: (line) => report.push(line),
  });
  assert.equal(readFileSync(path.join(home, 'config.toml'), 'utf8'), custom);
  assert.equal(report.some((line) => line.includes('custom configuration preserved')), true);
  assert.equal(report.some((line) => line.includes('SYSTEMONE provider')), false);
});

test('include-project-docs stages complete package reference docs without touching the target during staging', async (t) => {
  const root = tempDirectory(t); const hostStage = path.join(root, 'stage'); mkdirSync(hostStage);
  const result = await INSTALL_INTERNALS.buildHostStage({
    source: REPO_ROOT, home: path.join(root, 'claude'), host: 'claude', hostStage, runtimeRoot: REPO_ROOT,
    runtimeFiles: packageFiles, toolCommands: tools, layaManaged: true, effectiveLaya: false,
    withLaya: false, includeProjectDocs: true, codexText: '', codexConfigExisted: false,
    previousLaya: undefined, previousHost: new Set(),
  });
  assert.equal(existsSync(path.join(hostStage, 'docs/index.md')), true);
  assert.equal(existsSync(path.join(hostStage, 'open-spec-mesh/index.md')), true);
  assert.equal(result.managedPaths.has('docs'), true);
});

 test('invalid CLI options return usage error without starting installation', async () => {
  const capture = memoryStreams();
  const code = await import('../../../lib/installation/cli.js').then(({ runInstall }) => runInstall(['--unknown'], capture.streams));
  assert.equal(code, 2);
  assert.equal(capture.stdout, '');
  assert.match(capture.stderr, /Unknown install option/);
});


test('installer refuses unowned runtime and path symlink before installing any host artifact', async (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'codex');
  mkdirSync(path.join(home, 'open-spec-mesh', 'runtime'), { recursive: true });
  writeFileSync(path.join(home, 'open-spec-mesh', 'runtime', 'user-data.txt'), 'retain');
  await assert.rejects(installHost({
    source: REPO_ROOT, home, host: 'codex', dryRun: true, skipTools: true, nodeVersion: '24.21.0',
    env: { PATH: process.env.PATH ?? '' }, reporter: () => {},
  }), /Unmanaged non-empty runtime directory exists/);
  assert.equal(readFileSync(path.join(home, 'open-spec-mesh', 'runtime', 'user-data.txt'), 'utf8'), 'retain');
});

test('install help exits without resolving a runtime or touching Home', async () => {
  const capture = memoryStreams();
  const code = await import('../../../lib/installation/cli.js').then(({ runInstall }) => runInstall(['--help'], capture.streams));
  assert.equal(code, 0);
  assert.match(capture.stdout, /Usage: open-spec-mesh install/);
  assert.equal(capture.stderr, '');
});


test('missing required Research keys fail before creating a selected Home or its parents', async (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'not-created', 'codex');
  await assert.rejects(installHost({
    source: REPO_ROOT, home, host: 'codex', dryRun: false, skipTools: false,
    nodeVersion: '24.21.0', env: { PATH: process.env.PATH ?? '' }, reporter: () => {},
  }), /Missing required environment variables/);
  assert.equal(existsSync(path.dirname(home)), false);
  assert.equal(existsSync(home), false);
});
