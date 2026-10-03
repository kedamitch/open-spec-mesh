import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { pathToFileURL } from 'node:url';
import { INSTALL_INTERNALS, installHost, parseInstallArgs } from '../../../lib/installation/installer.js';
import { MANIFEST } from '../../../lib/installation/migrations.js';
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
    nodeVersion: '22.0.0', env: { PATH: process.env.PATH ?? '' }, reporter: (line) => report.push(line),
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(existsSync(home), false);
  assert.equal(report.some((line) => line.includes('dry-run: no target files changed')), true);
  assert.equal(report.some((line) => line.includes('SYSTEM ONE')), true);
});

test('dry-run leaves user configuration bytes untouched and never prints their contents', async (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'codex'); mkdirSync(home);
  const secret = 'Never deploy this token: synthetic-user-secret-should-not-leak';
  const config = `# user config\nmodel_provider = "private"\n# ${secret}\n`;
  const configPath = path.join(home, 'config.toml'); writeFileSync(configPath, config);
  const report = [];
  await installHost({
    source: REPO_ROOT, home, host: 'codex', dryRun: true, skipTools: true,
    nodeVersion: '22.0.0', env: { PATH: process.env.PATH ?? '' }, reporter: (line) => report.push(line),
  });
  assert.equal(readFileSync(configPath, 'utf8'), config);
  assert.equal(report.join('\n').includes(secret), false);
  assert.equal(existsSync(path.join(home, MANIFEST)), false);
});

test('legacy role tables are retired across inline, dotted and quoted TOML keys without changing custom roles', (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'home'); mkdirSync(home);
  const fixtures = [
    'agents = { e2e = { model = "old" }, custom = { model = "mine" } }\n',
    'agents.e2e.model = "old"\nagents.custom.model = "mine"\n',
    '[agents."e2e"]\nmodel = "old"\n[agents.custom]\nmodel = "mine"\n',
  ];
  for (const input of fixtures) {
    const { text } = INSTALL_INTERNALS.mergeConfig(REPO_ROOT, input, {
      previousCodex: { skills: [], roles: {} }, toolCommands: {}, effectiveLaya: false,
      withLaya: false, layaManaged: false, home,
    });
    const parsed = parseToml(text);
    assert.equal(Object.hasOwn(parsed.agents, 'e2e'), false);
    assert.equal(parsed.agents.custom.model, 'mine');
    assert.equal(Object.hasOwn(parsed.agents, 'max_depth'), false);
    assert.equal(parsed.features.multi_agent_v2.enabled, true);
    assert.equal(parsed.features.multi_agent_v2.max_concurrent_threads_per_session, 4);
  }
});

test('dry-run from a packaged source without Git history keeps stderr clean', (t) => {
  const root = tempDirectory(t); const packagedSource = path.join(root, 'package');
  mkdirSync(packagedSource);
  for (const relative of packageFiles) {
    const source = path.join(REPO_ROOT, relative); const destination = path.join(packagedSource, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  assert.equal(existsSync(path.join(packagedSource, '.git')), false);

  const home = path.join(root, 'home'); const runner = path.join(root, 'install.mjs');
  writeFileSync(runner, [
    `import { installHost } from ${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'lib/installation/installer.js')).href)};`,
    `await installHost({ source: ${JSON.stringify(packagedSource)}, home: ${JSON.stringify(home)}, host: 'codex',`,
    `  dryRun: true, skipTools: true, nodeVersion: '22.0.0', env: { PATH: ${JSON.stringify(process.env.PATH ?? '')} }, reporter: () => {} });`,
  ].join('\n'));
  const child = spawnSync(process.execPath, [runner], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 0, `packaged install failed\nstdout: ${child.stdout}\nstderr: ${child.stderr}`);
  assert.equal(child.stderr, '');
  assert.equal(existsSync(home), false);
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
  const rules = readFileSync(path.join(hostStage, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(rules, /本项目版本发布流程|npm-publish\.yml|36690250138/u);
  assert.ok(rules.includes(path.join(root, 'codex', 'open-spec-mesh', 'dispatch-contract.md')));
});

test('owned legacy Python bridge upgrades to disabled Node runtime without enabling Laya', async (t) => {
  const root = tempDirectory(t); const hostStage = path.join(root, 'stage'); mkdirSync(hostStage);
  const home = path.join(root, 'codex'); mkdirSync(home);
  const oldText = readFileSync(path.join(REPO_ROOT, 'tests/fixtures/migration/installation/legacy-python-bridge.toml'), 'utf8');
  const oldConfig = parseToml(oldText).mcp_servers.laya;
  mkdirSync(path.join(home, 'mcp/__pycache__'), { recursive: true });
  for (const name of ['laya_contracts.cpython-312.pyc', 'laya_runtime.cpython-312.opt-1.pyc', 'custom.cpython-312.pyc']) {
    writeFileSync(path.join(home, 'mcp/__pycache__', name), 'legacy cache');
  }
  const result = await INSTALL_INTERNALS.buildHostStage({
    source: REPO_ROOT, home, host: 'codex', hostStage, runtimeRoot: REPO_ROOT, runtimeFiles: packageFiles,
    toolCommands: tools, layaManaged: true, effectiveLaya: false, withLaya: false, includeProjectDocs: false,
    codexText: oldText, codexConfigExisted: true, previousLaya: oldConfig,
    previousHost: new Set(['open-spec-mesh/runtime', 'mcp/laya_http_mcp.js', 'mcp/laya-settings.json']),
  });
  for (const relative of ['mcp/laya_http_mcp.py', 'mcp/laya_contracts.py', 'mcp/laya_runtime.py']) assert.equal(result.operations.some((item) => item.relative === relative && item.source === null), true);
  for (const name of ['laya_contracts.cpython-312.pyc', 'laya_runtime.cpython-312.opt-1.pyc']) {
    assert.equal(result.operations.some((item) => item.relative === 'mcp/__pycache__/' + name && item.source === null), true);
  }
  assert.equal(result.operations.some((item) => item.relative.includes('custom.cpython')), false);
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
    nodeVersion: '22.0.0', env: { PATH: process.env.PATH ?? '' }, reporter: (line) => report.push(line),
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
    source: REPO_ROOT, home, host: 'codex', dryRun: true, skipTools: true, nodeVersion: '22.0.0',
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
    nodeVersion: '22.0.0', env: { PATH: process.env.PATH ?? '' }, reporter: () => {},
  }), /Missing required environment variables/);
  assert.equal(existsSync(path.dirname(home)), false);
  assert.equal(existsSync(home), false);
});


test('Node 22 minimum accepts all later majors and rejects older or malformed versions before writes', async (t) => {
  const root = tempDirectory(t);
  for (const version of ['22.0.0', '22.8.0', '23.0.0', '24.19.0', '26.0.0']) {
    const home = path.join(root, 'accepted-' + version);
    await installHost({ source: REPO_ROOT, home, host: 'codex', dryRun: true, skipTools: true, nodeVersion: version, env: { PATH: process.env.PATH ?? '' }, reporter: () => {} });
    assert.equal(existsSync(home), false);
  }
  for (const version of ['20.19.0', '21.9.0', 'invalid']) {
    const home = path.join(root, 'rejected-' + version);
    await assert.rejects(installHost({ source: REPO_ROOT, home, host: 'codex', dryRun: true, skipTools: true, nodeVersion: version, reporter: () => {} }), (error) => error.message.includes('Node.js 22.0.0+ is required'));
    assert.equal(existsSync(home), false);
  }
});


test('retired managed sdd-change is privately archived with user edits before leaving skill discovery', async (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'codex'); const hostStage = path.join(root, 'stage');
  mkdirSync(hostStage); mkdirSync(path.join(home, 'skills/sdd-change/scripts'), { recursive: true });
  const edited = '# My locally edited old skill\nKeep exact bytes.\n';
  writeFileSync(path.join(home, 'skills/sdd-change/SKILL.md'), edited);
  writeFileSync(path.join(home, 'skills/sdd-change/.private-notes'), 'keep hidden file');
  writeFileSync(path.join(home, 'skills/sdd-change/scripts/custom.js'), 'user helper');
  writeFileSync(path.join(home, MANIFEST), JSON.stringify({ schema: 1, package: 'kedamitch/open-spec-mesh', skills: ['sdd-change'], roles: [] }));
  const result = await INSTALL_INTERNALS.buildHostStage({
    source: REPO_ROOT, home, host: 'codex', hostStage, runtimeRoot: REPO_ROOT, runtimeFiles: packageFiles,
    toolCommands: tools, layaManaged: true, effectiveLaya: false, withLaya: false, includeProjectDocs: false,
    codexText: '', codexConfigExisted: false, previousLaya: undefined, previousHost: new Set(['skills/sdd-change']),
  });
  const archive = result.operations.find(item => item.relative.startsWith('open-spec-mesh/retired-skills/sdd-change-'));
  assert.ok(archive && archive.source.endsWith('.zip'));
  const contents = await JSZip.loadAsync(readFileSync(archive.source));
  assert.equal(await contents.file('SKILL.md').async('string'), edited);
  assert.equal(await contents.file('.private-notes').async('string'), 'keep hidden file');
  assert.equal(await contents.file('scripts/custom.js').async('string'), 'user helper');
  assert.equal(result.managedPaths.has(archive.relative), false, 'future upgrades must not remove recovery archives');
  assert.ok(result.operations.some(item => item.relative === 'skills/sdd-change' && item.source === null));
  for (const name of ['sdd-req', 'sdd-design', 'sdd-plan']) assert.ok(result.managedPaths.has('skills/' + name));
  assert.equal(result.managedPaths.has('skills/sdd-change'), false);
  assert.equal(readFileSync(path.join(home, 'skills/sdd-change/SKILL.md'), 'utf8'), edited, 'staging must not change Home');
  assert.ok(result.warnings.some(warning => warning.includes(archive.relative)));
});

test('unmanaged old sdd-change is preserved rather than deleted by its name', async (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'claude'); const hostStage = path.join(root, 'stage');
  mkdirSync(hostStage); mkdirSync(path.join(home, 'skills/sdd-change'), { recursive: true });
  writeFileSync(path.join(home, 'skills/sdd-change/SKILL.md'), '# Personal skill\n');
  const result = await INSTALL_INTERNALS.buildHostStage({
    source: REPO_ROOT, home, host: 'claude', hostStage, runtimeRoot: REPO_ROOT, runtimeFiles: packageFiles,
    toolCommands: tools, layaManaged: true, effectiveLaya: false, withLaya: false, includeProjectDocs: false,
    codexText: '', codexConfigExisted: false, previousLaya: undefined, previousHost: new Set(),
  });
  assert.equal(result.operations.some(item => item.relative === 'skills/sdd-change'), false);
  assert.equal(readFileSync(path.join(home, 'skills/sdd-change/SKILL.md'), 'utf8'), '# Personal skill\n');
  assert.ok(result.warnings.some(warning => warning.includes('Retained unmanaged skills/sdd-change')));
});


test('former managed requirements name is archived and replaced by sdd-req without touching unmanaged copies', async (t) => {
  const root = tempDirectory(t);
  for (const owned of [true, false]) {
    const home = path.join(root, owned ? 'owned-home' : 'unmanaged-home');
    const hostStage = path.join(root, owned ? 'owned-stage' : 'unmanaged-stage');
    mkdirSync(hostStage); mkdirSync(path.join(home, 'skills/sdd-requirements'), { recursive: true });
    const content = '# Locally edited requirements skill\nKeep exact bytes.\n';
    writeFileSync(path.join(home, 'skills/sdd-requirements/SKILL.md'), content);
    if (owned) writeFileSync(path.join(home, MANIFEST), JSON.stringify({ schema: 1, package: 'kedamitch/open-spec-mesh', skills: ['sdd-requirements'], roles: [] }));
    const result = await INSTALL_INTERNALS.buildHostStage({
      source: REPO_ROOT, home, host: 'codex', hostStage, runtimeRoot: REPO_ROOT, runtimeFiles: packageFiles,
      toolCommands: tools, layaManaged: true, effectiveLaya: false, withLaya: false, includeProjectDocs: false,
      codexText: '', codexConfigExisted: false, previousLaya: undefined,
      previousHost: owned ? new Set(['skills/sdd-requirements']) : new Set(),
    });
    assert.equal(result.managedPaths.has('skills/sdd-req'), true);
    assert.equal(result.managedPaths.has('skills/sdd-requirements'), false);
    const archive = result.operations.find(item => item.relative.startsWith('open-spec-mesh/retired-skills/sdd-requirements-'));
    assert.equal(Boolean(archive), owned);
    assert.equal(result.operations.some(item => item.relative === 'skills/sdd-requirements' && item.source === null), owned);
    if (archive) {
      const zip = await JSZip.loadAsync(readFileSync(archive.source));
      assert.equal(await zip.file('SKILL.md').async('string'), content);
    } else assert.ok(result.warnings.some(warning => warning.includes('Retained unmanaged skills/sdd-requirements')));
    assert.equal(readFileSync(path.join(home, 'skills/sdd-requirements/SKILL.md'), 'utf8'), content);
  }
});


test('upgrades refresh managed role selection prompts while preserving user configuration', (t) => {
  const root = tempDirectory(t); const home = path.join(root, 'home'); mkdirSync(home);
  const canonical = parseToml(readFileSync(path.join(REPO_ROOT, 'agents/architect.toml'), 'utf8')).description;
  const fixtures = [
    'agents = { architect = { description = "半自动 Task Graph", config_file = "agents/architect.toml", model = "user-model" }, custom = { description = "User role" } }\n',
    'agents.architect.description = "半自动 Task Graph"\nagents.architect.config_file = "agents/architect.toml"\nagents.architect.model = "user-model"\nagents.custom.description = "User role"\n',
    '[agents."architect"]\ndescription = "半自动 Task Graph"\nconfig_file = "agents/architect.toml"\nmodel = "user-model"\n[agents.custom]\ndescription = "User role"\n',
  ];
  const options = {
    previousCodex: { skills: [], roles: { architect: 'agents/architect.toml' } }, toolCommands: {},
    effectiveLaya: false, withLaya: false, layaManaged: false, home,
  };
  for (const input of fixtures) {
    const { text } = INSTALL_INTERNALS.mergeConfig(REPO_ROOT, input, options);
    const parsed = parseToml(text);
    assert.equal(parsed.agents.architect.description, canonical);
    assert.equal(parsed.agents.architect.config_file, 'agents/architect.toml');
    assert.equal(parsed.agents.architect.model, 'user-model');
    assert.equal(parsed.agents.custom.description, 'User role');
    assert.equal(INSTALL_INTERNALS.mergeConfig(REPO_ROOT, text, options).text, text);
    const unowned = INSTALL_INTERNALS.mergeConfig(REPO_ROOT, input, { ...options, previousCodex: { skills: [], roles: {} } });
    assert.equal(parseToml(unowned.text).agents.architect.description, '半自动 Task Graph');
  }
});

test('legacy subagent default migration is explicit, narrow, idempotent and preserves Main/custom models', (t) => {
  const root = tempDirectory(t), home = path.join(root, 'home'); mkdirSync(home);
  const options = { previousCodex: { skills: [], roles: {} }, toolCommands: {}, effectiveLaya: false, withLaya: false, layaManaged: false, home };
  const input = 'model="my-main"\nmodel_reasoning_effort="high"\n[agents]\ndefault_subagent_model="gpt-5.6-luna"\ndefault_subagent_reasoning_effort="max"\n';
  const unchanged = INSTALL_INTERNALS.mergeConfig(REPO_ROOT, input, options);
  assert.equal(parseToml(unchanged.text).agents.default_subagent_model, 'gpt-5.6-luna');
  const migrated = INSTALL_INTERNALS.mergeConfig(REPO_ROOT, input, { ...options, migrateLegacyAgentDefaults: true });
  const result = parseToml(migrated.text);
  assert.equal(result.model, 'my-main'); assert.equal(result.model_reasoning_effort, 'high');
  assert.equal(result.agents.default_subagent_model, 'gpt-6-luna'); assert.equal(result.agents.default_subagent_reasoning_effort, 'max');
  assert.equal(INSTALL_INTERNALS.mergeConfig(REPO_ROOT, migrated.text, { ...options, migrateLegacyAgentDefaults: true }).text, migrated.text);
  const custom = INSTALL_INTERNALS.mergeConfig(REPO_ROOT, input.replace('gpt-5.6-luna', 'my-subagent'), { ...options, migrateLegacyAgentDefaults: true });
  assert.equal(parseToml(custom.text).agents.default_subagent_model, 'my-subagent');
  assert.equal(parseInstallArgs(['--migrate-legacy-agent-defaults']).migrateLegacyAgentDefaults, true);
});

test('non-Codex legacy-default migration is refused before creating Home', async (t) => {
  const home = path.join(tempDirectory(t), 'absent');
  await assert.rejects(installHost({ source: REPO_ROOT, home, host: 'claude', migrateLegacyAgentDefaults: true, dryRun: true }), /only supports codex/u);
  assert.equal(existsSync(home), false);
});

test('explicit migration flows through transactional installation and keeps actual Main overrides', async (t) => {
  const home = path.join(tempDirectory(t), 'home'); mkdirSync(home);
  writeFileSync(path.join(home, 'config.toml'), 'model="user-main"\nmodel_reasoning_effort="high"\n[agents]\ndefault_subagent_model="gpt-5.6-luna"\ndefault_subagent_reasoning_effort="max"\n');
  await installHost({ source: REPO_ROOT, home, skipTools: true, migrateLegacyAgentDefaults: true, reporter: () => {} });
  const config = parseToml(readFileSync(path.join(home, 'config.toml'), 'utf8'));
  assert.equal(config.model, 'user-main'); assert.equal(config.model_reasoning_effort, 'high');
  assert.equal(config.agents.default_subagent_model, 'gpt-6-luna');
  assert.equal(config.agents.default_subagent_reasoning_effort, 'max');
});


test('successful CLI installation reports files only, not automatic live-session activation', async (t) => {
  const home = path.join(tempDirectory(t), 'codex');
  const capture = memoryStreams();
  const { runInstall } = await import('../../../lib/installation/installer.js');
  const code = await runInstall(['--host', 'codex', '--host-home', home, '--skip-tools'], {
    ...capture.streams, runtime: { packageRoot: REPO_ROOT },
  });
  assert.equal(code, 0, capture.stderr);
  assert.match(capture.stdout, /installed-file state only/u);
  assert.match(capture.stdout, /reload configuration in the actual codex host and verify dispatch/u);
  assert.match(capture.stdout, /existing sessions are not proven updated/u);
  assert.doesNotMatch(capture.stdout, /start a new codex session/u);
});
