#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function nodeVersionAtLeast(version, minimum = [22, 0, 0]) {
  const actual = String(version).replace(/^v/u, '').split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((actual[index] ?? 0) > minimum[index]) return true;
    if ((actual[index] ?? 0) < minimum[index]) return false;
  }
  return true;
}
function executable(command, env = process.env) {
  for (const directory of String(env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* try next PATH entry */ }
  }
  return null;
}
function run(command, args, { cwd, env = process.env, timeout = 180_000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, shell: false, windowsHide: true });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  const record = { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  if (!allowFailure && record.code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${record.code}): ${(record.stderr || record.stdout).slice(-5000)}`);
  return record;
}
function makeNodeOnlyPath(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const links = { node: process.execPath, npm: executable('npm'), git: executable('git') };
  for (const [name, target] of Object.entries(links)) {
    if (!target) throw new Error(`${name} is required for the isolated consumer smoke`);
    fs.symlinkSync(target, path.join(directory, name));
  }
  return directory;
}
function snapshotPath(target) {
  try {
    const stat = fs.statSync(target);
    return { exists: true, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
  } catch (error) { if (error?.code === 'ENOENT') return { exists: false }; throw error; }
}

async function mcpSdkSmoke({ consumerRoot, bin, cwd, env }) {
  const requireConsumer = createRequire(path.join(consumerRoot, 'package.json'));
  const clientPath = requireConsumer.resolve('@modelcontextprotocol/sdk/client/index.js');
  const stdioPath = requireConsumer.resolve('@modelcontextprotocol/sdk/client/stdio.js');
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(clientPath).href), import(pathToFileURL(stdioPath).href),
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, 'systemone'],
    cwd,
    env,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.setEncoding?.('utf8');
  transport.stderr?.on?.('data', (chunk) => { stderr += chunk; });
  const client = new Client({ name: 'open-spec-mesh-tarball-smoke', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ['laya_status', 'laya_templates', 'laya_decide', 'laya_predict']);
    process.stdout.write('Installed public systemone command exposed all four MCP SDK tools.\n');
  } catch (error) {
    throw new Error(`PUBLIC_SYSTEMONE_ROUTE_FAILED: installed command "open-spec-mesh systemone" exited before MCP initialize/listTools; stderr=${stderr.trim() || '(empty)'}; transport=${error.message}`);
  } finally { await client.close().catch(() => {}); }
}

export async function verifyTarball() {
  if (!nodeVersionAtLeast(process.versions.node)) throw new Error(`Tarball consumer requires Node >=22.0.0; actual ${process.versions.node}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-tarball-consumer-'));
  const beforeNodeModules = snapshotPath(path.join(ROOT, 'node_modules'));
  const cache = path.join(temp, 'npm-cache'); const packDestination = path.join(temp, 'pack');
  const globalPrefix = path.join(temp, 'global prefix');
  const prefix = path.join(temp, 'consumer'); const home = path.join(temp, 'home'); const project = path.join(temp, 'project');
  const sandboxBin = makeNodeOnlyPath(path.join(temp, 'node-only-bin'));
  for (const directory of [cache, packDestination, prefix, globalPrefix, home, project]) fs.mkdirSync(directory, { recursive: true });
  const userSentinel = path.join(home, 'user-owned-sentinel.txt');
  fs.writeFileSync(userSentinel, 'keep outside the selected managed Home\n');
  const sentinelBefore = fs.readFileSync(userSentinel);
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_STATE_HOME: path.join(home, '.state'),
    OPEN_SPEC_MESH_STATE_HOME: path.join(home, '.state', 'open-spec-mesh'),
    PATH: sandboxBin,
    npm_config_cache: cache,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };
  const npm = executable('npm');
  if (!npm) { fs.rmSync(temp, { recursive: true, force: true }); throw new Error('npm is required for isolated tarball installation'); }
  try {
    run('git', ['init', '-q', '--initial-branch=main', project], { cwd: temp, env });
    run('git', ['-C', project, 'config', 'user.name', 'Tarball Smoke']);
    run('git', ['-C', project, 'config', 'user.email', 'tarball-smoke@example.invalid']);

    const packed = run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', packDestination, '--cache', cache], { cwd: ROOT, env, timeout: 180_000 });
    const packInfo = JSON.parse(packed.stdout)[0];
    const tarball = path.join(packDestination, packInfo.filename);
    assert.ok(fs.statSync(tarball).isFile(), 'npm pack did not create a tarball');
    assert.ok(packInfo.files.some((item) => item.path === 'npm-shrinkwrap.json'), 'Tarball omitted npm-shrinkwrap.json');
    assert.ok(!packInfo.files.some((item) => item.path.endsWith('.py') || item.path.startsWith('node_modules/')),
      'Tarball must contain no Python source or dependency tree');

    run(npm, ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, tarball], { cwd: temp, env, timeout: 600_000 });
    // Exercise real npm -g, its executable shim, and package-relative runtime
    // discovery. Neither local nor global npm installation may configure Home.
    run(npm, ['install', '--global', '--prefix', globalPrefix, '--no-audit', '--no-fund', '--cache', cache, tarball], { cwd: temp, env, timeout: 600_000 });
    const globalBin = path.join(globalPrefix, 'bin/open-spec-mesh');
    assert.ok(fs.existsSync(globalBin), 'npm -g did not create its global executable');
    const globalEnv = { ...env, PATH: path.dirname(globalBin) + path.delimiter + env.PATH };
    const globalCli = (args, options = {}) => run('open-spec-mesh', args, { cwd: project, env: globalEnv, ...options });
    assert.equal(globalCli(['--version']).stdout.trim(), packInfo.version);
    assert.equal(run('osm', ['--version'], { cwd: project, env: globalEnv }).stdout.trim(), packInfo.version);
    assert.match(run('osm', ['--help'], { cwd: project, env: globalEnv }).stdout, /Usage: osm/u);
    assert.match(globalCli(['--help']).stdout, /init-project/u);
    assert.equal(fs.existsSync(path.join(env.CODEX_HOME, 'AGENTS.md')), false, 'npm -g must not silently configure the host');
    const otherProject = path.join(temp, 'global project with spaces');
    fs.mkdirSync(otherProject);
    globalCli(['init-project', '--root', otherProject]);
    assert.equal(globalCli(['validate-docs', '--root', otherProject]).stdout.trim(), 'docs: valid');

    const consumerRoot = path.join(prefix, 'node_modules/open-spec-mesh');
    const bin = path.join(consumerRoot, 'bin/open-spec-mesh.js');
    assert.ok(fs.existsSync(bin), 'Installed package bin entry is missing');
    // The documented checkout command must work too, not just npm -g a tarball.
    const directoryGlobalPrefix = path.join(temp, 'checkout global prefix');
    run(npm, ['install', '--global', '--prefix', directoryGlobalPrefix, '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, ROOT], { cwd: temp, env });
    const directoryEnv = { ...env, PATH: path.join(directoryGlobalPrefix, 'bin') + path.delimiter + env.PATH };
    assert.equal(run('open-spec-mesh', ['--version'], { cwd: otherProject, env: directoryEnv }).stdout.trim(), packInfo.version);
    assert.match(run('open-spec-mesh', ['--help'], { cwd: otherProject, env: directoryEnv }).stdout, /init-project/u);

    const cli = (args, options = {}) => run(process.execPath, [bin, ...args], { cwd: project, env, ...options });

    assert.equal(cli(['--version']).stdout.trim(), JSON.parse(fs.readFileSync(path.join(consumerRoot, 'package.json'), 'utf8')).version);
    const help = cli(['--help']).stdout;
    for (const command of ['init-project', 'validate-docs', 'new-change', 'new-task', 'ensure-design', 'observe', 'diagnose', 'systemone', 'inspect-host', 'evaluate-collaboration']) assert.ok(help.includes(command), `Installed CLI help omitted ${command}`);
    assert.equal(JSON.parse(cli(['inspect-host', '--home', path.join(temp, 'absent-host'), '--format', 'json']).stdout).live_session.status, 'unknown');
    assert.equal(JSON.parse(cli(['evaluate-collaboration', '--list']).stdout).length, 6);
    assert.match(cli(['evaluate-collaboration', '--list', '--format', 'md']).stdout, /local-fix/u);
    const evaluationInput = path.join(temp, 'evaluation-report.json');
    fs.writeFileSync(evaluationInput, JSON.stringify({ events: [], sessions: [], coverage: { status: 'partial' } }));
    const evaluationArgs = ['evaluate-collaboration', '--report', evaluationInput, '--scenario', 'local-fix'];
    assert.equal(JSON.parse(cli(evaluationArgs).stdout).status, 'incomplete');
    const strictEvaluation = cli([...evaluationArgs, '--format', 'md', '--fail-on-incomplete'], { allowFailure: true });
    assert.equal(strictEvaluation.code, 3);
    assert.match(strictEvaluation.stdout, /incomplete/u);
    assert.match(strictEvaluation.stdout, /Semantic quality: unverified/u);
    assert.equal(globalCli([...evaluationArgs, '--format', 'md', '--fail-on-incomplete'], { allowFailure: true }).code, 3);
    cli(['init-project', '--root', project]);
    cli(['validate-docs', '--root', project]);
    run('git', ['-C', project, 'add', '-A'], { cwd: temp, env });
    run('git', ['-C', project, 'commit', '-m', 'Initialize isolated tarball consumer fixture', '--quiet'], { cwd: temp, env });
    const active = path.join(project, 'docs/05-changes/C01-进行中');
    const beforeChanges = new Set(fs.readdirSync(active).filter((name) => fs.statSync(path.join(active, name)).isDirectory()));
    cli(['new-change', 'tarball-consumer-smoke', '--root', project]);
    const changes = fs.readdirSync(active).filter((name) => fs.statSync(path.join(active, name)).isDirectory() && !beforeChanges.has(name));
    assert.equal(changes.length, 1, `Expected one newly generated Change, got ${changes.length}`);
    const changeId = changes[0];
    assert.equal(fs.existsSync(path.join(active, changeId, 'C02-design.md')), false);
    cli(['ensure-design', changeId, '--root', project]);
    cli(['new-task', changeId, 'smoke-task', '--root', project]);
    const taskGraphPath = path.join(active, changeId, 'C03-tasks/C03-task-graph.json');
    assert.equal(fs.existsSync(taskGraphPath), false);
    assert.match(fs.readFileSync(path.join(active, changeId, 'C03-tasks/C03-task-plan.md'), 'utf8'), /C03-01/);
    assert.ok(!help.includes('\n  sdd\n'));

    const stateDirectory = path.join(temp, 'private-observation-store');
    fs.mkdirSync(stateDirectory, { mode: 0o700 });
    const database = path.join(stateDirectory, 'observations.sqlite3');
    cli(['observe', '--host', 'opencode', '--db', database, 'collect', '--run', 'tarball-smoke', '--root', project, '--expected-mode', 'unknown']);
    cli(['observe', '--host', 'opencode', '--db', database, 'summary']);
    assert.ok(fs.readFileSync(database).subarray(0, 16).toString('ascii').startsWith('SQLite format 3'), 'Observation command did not create SQLite');

    const managedHome = path.join(home, '.codex');
    // Seed the four named old scripts plus another Python tool to prove this
    // is a directory replacement, not just four one-off unlink operations.
    const previousSkills = ['sdd-change', 'sdd-requirements', 'sdd-plan', 'sdd-do', 'sdd-close', 'sdd-init'];
    fs.mkdirSync(managedHome, { recursive: true });
    fs.writeFileSync(path.join(managedHome, '.open-spec-mesh-managed.json'), JSON.stringify({ schema: 1, package: 'kedamitch/open-spec-mesh', skills: previousSkills, roles: [] }));
    const legacy = ['skills/sdd-change/scripts/sdd.py', 'skills/sdd-change/scripts/task_graph.py', 'skills/sdd-requirements/scripts/new_change.js', 'skills/sdd-do/scripts/run_leaf.py', 'skills/sdd-close/scripts/close_change.py', 'skills/sdd-init/scripts/new_document.py', 'skills/sdd-plan/scripts/legacy.py'];
    for (const file of legacy) { fs.mkdirSync(path.dirname(path.join(managedHome, file)), { recursive: true }); fs.writeFileSync(path.join(managedHome, file), '# historical package script\n'); }
    const unmanaged = path.join(managedHome, 'skills/user-tool/script.py');
    fs.mkdirSync(path.dirname(unmanaged), { recursive: true }); fs.writeFileSync(unmanaged, '# preserve user tool\n');
    const preview = run('osm', ['--dry-run', '--codex-home', managedHome], { cwd: project, env: globalEnv });
    assert.match(preview.stdout, /dry-run: no target files changed/u);
    run('osm', [], { cwd: project, env: { ...globalEnv, CODEX_HOME: managedHome } });
    for (const file of legacy) assert.equal(fs.existsSync(path.join(managedHome, file)), false, 'Retired resource survived upgrade: ' + file);
    assert.equal(fs.readFileSync(unmanaged, 'utf8'), '# preserve user tool\n');
    assert.match(fs.readFileSync(path.join(managedHome, 'AGENTS.md'), 'utf8'), /role_desc/u);
    assert.match(fs.readFileSync(path.join(managedHome, 'skills/sdd-do/SKILL.md'), 'utf8'), /当前 Agent 串行/u);
    for (const entry of ['sdd-init/scripts/init_project.js', 'sdd-req/scripts/new_change.js', 'sdd-design/scripts/ensure_design.js', 'sdd-plan/scripts/new_task.js', 'sdd-release/scripts/new_release.js']) {
      const result = run(process.execPath, [path.join(managedHome, 'skills', entry), '--help'], { cwd: temp, env });
      assert.match(result.stdout, /Usage:/u, 'Installed Skill entrypoint must execute its handler: ' + entry);
    }
    assert.equal(fs.existsSync(path.join(managedHome, 'package.json')), false, 'Do not change unrelated Home module scopes');
    assert.equal(fs.existsSync(path.join(managedHome, 'mcp/package.json')), false, 'Do not change unrelated MCP module scopes');
    const zip = path.join(home, 'diagnostics.zip');
    cli(['diagnose', '--root', project, '--output', zip, '--sessions-dir', path.join(managedHome, 'sessions'), '--rules-root', path.join(managedHome, 'skills')]);
    assert.ok(fs.readFileSync(zip).subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'Diagnostics did not write a ZIP archive');
    const requireConsumer = createRequire(path.join(consumerRoot, 'package.json'));
    const JSZip = requireConsumer('jszip');
    const archive = await JSZip.loadAsync(fs.readFileSync(zip));
    assert.ok(Object.keys(archive.files).length > 0, 'Diagnostic ZIP is empty');

    await mcpSdkSmoke({ consumerRoot, bin: globalBin, cwd: project, env: globalEnv });

    assert.deepEqual(fs.readFileSync(userSentinel), sentinelBefore, 'Unmanaged user Home sentinel changed');
    assert.deepEqual(snapshotPath(path.join(ROOT, 'node_modules')), beforeNodeModules, 'Root node_modules directory metadata changed during consumer smoke');
    process.stdout.write(`Local/global npm consumer smoke passed for ${packInfo.name}@${packInfo.version}; local artifact only; npm registry publication not performed.\n`);
    return { package: `${packInfo.name}@${packInfo.version}`, tarball, project, database, zip };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyTarball().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
