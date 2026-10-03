import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspectHost, inspectMarkdown, runInspectHost } from '../../../lib/installation/inspect.js';
import { renderRules, renderMain, renderOpenCodeAgentMap, ROLES } from '../../../lib/installation/host-adapter.js';
import { tempDirectory, REPO_ROOT, memoryStreams } from './helpers.js';

const put = (root, file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
test('every host rule and primary prompt uses the common source, not project release details', () => {
  for (const host of ['codex', 'opencode', 'claude']) for (const text of [renderRules(REPO_ROOT, host, '/var/tmp/home'), renderMain(REPO_ROOT, host, '/var/tmp/home')]) {
    assert.match(text, /净收益/u);
    assert.doesNotMatch(text, /36690250138|本项目版本发布流程|npm-publish\.yml/u);
  }
  assert.doesNotMatch(renderOpenCodeAgentMap(REPO_ROOT, '/var/tmp/home').main.prompt, /npm-publish\.yml/u);
});

test('host inspection is read-only, redacted, and distinguishes file drift from unknown live state', (t) => {
  const home = tempDirectory(t); const secret = 'sk-SYNTHETIC-NEVER-REPORT';
  put(home, 'config.toml', `model = "user-model"\nmodel_reasoning_effort = "high"\n[model_providers.custom]\napi_key = "${secret}"\n${ROLES.map(r => `[agents.${r}]\nconfig_file = "agents/${r}.toml"`).join('\n')}\n`);
  for (const role of ROLES) fs.copyFileSync(path.join(REPO_ROOT, 'agents', `${role}.toml`), (fs.mkdirSync(path.join(home, 'agents'), { recursive: true }), path.join(home, 'agents', `${role}.toml`)));
  put(home, 'agents/explorer.toml', 'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "low"\n');
  put(home, 'auth.json', secret); put(home, 'open-spec-mesh/runtime/.open-spec-mesh-runtime.json', '{"schema":1,"name":"open-spec-mesh","version":"0.0.2"}');
  const before = fs.readFileSync(path.join(home, 'config.toml'));
  const report = inspectHost({ home });
  assert.equal(report.main.model, 'user-model');
  assert.equal(report.roles.find(r => r.role === 'explorer').comparison, 'differs_from_package');
  assert.equal(report.roles.find(r => r.role === 'worker').comparison, 'matches_package');
  assert.equal(report.live_session.status, 'unknown'); assert.equal(report.package_version, '0.0.2');
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.deepEqual(fs.readFileSync(path.join(home, 'config.toml')), before);
});

test('missing, malformed and redirected configs remain unknown without leaking parser text', (t) => {
  const home = tempDirectory(t); put(home, 'config.toml', 'api_key = "sk-SYNTHETIC-BROKEN\n');
  const broken = inspectHost({ home }); assert.equal(broken.config_status, 'unreadable_or_invalid');
  assert.equal(JSON.stringify(broken).includes('sk-SYNTHETIC'), false);
  put(home, 'config.toml', '[agents.explorer]\nconfig_file = "../outside.toml"\n[agents.worker]\nconfig_file = "agents/worker.toml"\n');
  fs.mkdirSync(path.join(home, 'agents')); fs.symlinkSync(path.join(REPO_ROOT, 'agents/worker.toml'), path.join(home, 'agents/worker.toml'));
  const report = inspectHost({ home });
  assert.equal(report.roles.find(r => r.role === 'explorer').status, 'outside_home');
  assert.equal(report.roles.find(r => r.role === 'worker').status, 'symlink_refused');
  assert.equal(report.roles.find(r => r.role === 'librarian').status, 'unregistered');
});

test('native inherited hosts and CLI expose evidence limitations rather than inferred models', async (t) => {
  const home = tempDirectory(t); put(home, 'agents/explorer.md', '---\nmodel: inherit\n---\nbody\n');
  const report = inspectHost({ host: 'claude', home });
  assert.equal(report.roles.find(r => r.role === 'explorer').comparison, 'host_inheritance_not_resolved');
  assert.equal(report.live_session.model, null);
  const streams = memoryStreams(); assert.equal(await runInspectHost(['--home', home, '--format', 'json'], streams.streams), 0);
  assert.equal(JSON.parse(streams.stdout).basis, 'installed_files_only');
  await assert.rejects(runInspectHost(['--host', 'invented'], streams.streams), /Invalid/u);
});

test('inspection exposes a stale fallback separately from otherwise matching role TOMLs without mutating it', (t) => {
  const home = tempDirectory(t);
  put(home, 'config.toml', 'model="my-main"\n[agents]\ndefault_subagent_model="gpt-5.6-luna"\ndefault_subagent_reasoning_effort="max"\n[agents.explorer]\nconfig_file="agents/explorer.toml"\n');
  put(home, 'agents/explorer.toml', fs.readFileSync(path.join(REPO_ROOT, 'agents/explorer.toml'), 'utf8'));
  const before = fs.readFileSync(path.join(home, 'config.toml'));
  const report = inspectHost({ home });
  assert.equal(report.roles.find(r => r.role === 'explorer').comparison, 'matches_package');
  assert.equal(report.subagent_defaults.model, 'gpt-5.6-luna');
  assert.equal(report.subagent_defaults.package_model, 'gpt-6-luna');
  assert.equal(report.subagent_defaults.warning, 'legacy_default_requires_explicit_migration');
  assert.equal(report.live_session.status, 'unknown');
  assert.deepEqual(fs.readFileSync(path.join(home, 'config.toml')), before);
});


test('matching all role files cannot hide a legacy default; recovery is actionable and read-only', (t) => {
  const home = tempDirectory(t);
  put(home, 'config.toml', 'model="custom-main"\n[agents]\ndefault_subagent_model="gpt-5.6-luna"\ndefault_subagent_reasoning_effort="max"\n'
    + ROLES.map(r => `[agents.${r}]\nconfig_file="agents/${r}.toml"\n`).join(''));
  for (const role of ROLES) put(home, `agents/${role}.toml`, fs.readFileSync(path.join(REPO_ROOT, 'agents', `${role}.toml`), 'utf8'));
  const before = fs.readFileSync(path.join(home, 'config.toml'));
  const report = inspectHost({ home });
  assert.ok(report.roles.every(r => r.comparison === 'matches_package'));
  assert.equal(report.subagent_defaults.warning, 'legacy_default_requires_explicit_migration');
  const md = inspectMarkdown(report);
  assert.match(md, /先校验默认子代理模型，再加载角色 TOML/u);
  assert.match(md, /同一个 Home.*--migrate-legacy-agent-defaults/u);
  assert.match(md, /配置快照.*实际宿主/su);
  assert.match(md, /不要在 spawn 时覆盖模型/u);
  assert.equal(report.live_session.status, 'unknown');
  assert.deepEqual(fs.readFileSync(path.join(home, 'config.toml')), before);
});

test('inspection does not recommend migrating a current or arbitrary custom default', (t) => {
  const home = tempDirectory(t);
  for (const model of ['gpt-6-luna', 'my-custom-model']) {
    put(home, 'config.toml', `[agents]\ndefault_subagent_model="${model}"\n`);
    const report = inspectHost({ home });
    assert.equal(report.subagent_defaults.warning, null);
    assert.doesNotMatch(inspectMarkdown(report), /--migrate-legacy-agent-defaults/u);
  }
});
