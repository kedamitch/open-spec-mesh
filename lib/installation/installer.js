import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import path from 'node:path';
import { withInstallLock } from '../runtime/locks.js';
import { resolveRuntime } from '../runtime/location.js';
import { DELETE, parseToml, setTomlValue } from './toml.js';
import {
  HOSTS, ROLES, adaptSkillMarkdown, hostProfile, renderDispatchContract,
  renderMain, renderMcpOverlay, renderOpenCodeAgentMap, renderRole, renderRules,
} from './host-adapter.js';
import {
  HOST_MANIFEST, MANIFEST, PACKAGE_ID,
  cleanAgents, catalog, hostManifestText, manifestText, readHostManifest, readManifest, retirement,
} from './migrations.js';
import { buildRuntimeStage, compareLockBytes, validateRuntimeOwnership } from './runtime-stage.js';
import {
  checkResearchKeys, RESEARCH_TOOLS, safePath, safeTree,
  ensureResearchTools,
} from './tools.js';
import {
  checkSystemOneEnvironment, cleanLayaEnvironment, FORWARDED_ENV,
  layaMcpConfig, managedLayaConfig, managedNodeLayaConfig,
} from './systemone-config.js';
import {
  commitTransaction, createTransaction, safeHome, targetPath,
} from './transaction.js';

export const CORE_SKILLS = Object.freeze(['sdd-init', 'sdd-migrate', 'sdd-req', 'sdd-design', 'sdd-plan', 'sdd-do', 'sdd-close', 'sdd-research', 'sdd-release', 'sdd-diagnose']);
export const COMPAT_SKILLS = Object.freeze(['prd-spec', 'design-overview']);
export const LAYA_SKILL = 'typesafe-laya';
export const SKILLS = Object.freeze([...CORE_SKILLS, ...COMPAT_SKILLS]);
export const LAYA_POLICY = '\n## 可复用语义判断\n\n只有同类判断批量或反复执行且有实际收益时，按 `typesafe-laya/SKILL.md` 复用命名模板；新场景先定义、验证一次，再重复执行。明确或一次性判断直接完成。不为调用 Laya 重新总结长上下文，不每轮调用、不增加阶段。工具失败或不确定时原角色继续；不改变审批、角色权限、模型配置和验收要求。\n';

function hasPath(target) {
  try { lstatSync(target); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function nodeVersionTuple(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  return match ? match.slice(1).map(Number) : null;
}
function assertNodeEngine(version = process.versions.node) {
  const found = nodeVersionTuple(version);
  if (!found || found[0] < 22) throw new Error(`Node.js 22.0.0+ is required (current: ${version})`);
}
function ensureExistingParent(home) {
  const missing = []; let cursor = path.dirname(path.resolve(home));
  while (!hasPath(cursor)) {
    missing.push(cursor); const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`No existing parent for host Home: ${home}`);
    cursor = parent;
  }
  safePath(cursor);
  const stat = lstatSync(cursor);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Host Home parent is not a directory: ${cursor}`);
  for (const directory of missing.reverse()) mkdirSync(directory, { mode: 0o700 });
  return missing;
}
function removeEmptyParents(paths) {
  for (const directory of [...paths].reverse()) {
    try { rmdirSync(directory); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error; }
  }
}
function writeStageFile(stageRoot, relative, contents, mode = 0o644) {
  const target = targetPath(stageRoot, relative);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  writeFileSync(target, contents, { mode });
  return target;
}
function copyTree(source, destination, { allow = () => true, rewriteMarkdown = null } = {}) {
  safeTree(source);
  const sourceStat = lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Expected package asset directory: ${source}`);
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  const visit = (src, dst, relative = '') => {
    for (const name of readdirSync(src).sort()) {
      if (name === 'node_modules' || name === '.git' || name === '__pycache__') continue;
      const from = path.join(src, name); const to = path.join(dst, name); const item = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(from);
      if (stat.isSymbolicLink()) throw new Error(`Refusing package symlink: ${from}`);
      if (stat.isDirectory()) { mkdirSync(to, { recursive: true, mode: 0o755 }); visit(from, to, item); }
      else if (stat.isFile() && allow(item, from)) {
        mkdirSync(path.dirname(to), { recursive: true, mode: 0o755 });
        if (rewriteMarkdown && path.extname(name).toLowerCase() === '.md') writeFileSync(to, rewriteMarkdown(readFileSync(from, 'utf8')), { mode: stat.mode & 0o777 });
        else writeFileSync(to, readFileSync(from), { mode: stat.mode & 0o777 });
      }
    }
  };
  visit(source, destination);
}
function packageAssetFilter(relative) {
  return /\.(?:md|js|sh|json|ya?ml|svg|toml|txt|css|mjs|cjs)$/iu.test(relative)
    && !/\.(?:py|pyc|pyo)$/iu.test(relative)
    && !relative.split('/').some((part) => part.startsWith('.'));
}
function managedLayaServer(config, home) {
  return config === undefined || config === null || managedLayaConfig(config, home);
}
function readCodexConfig(home, source) {
  const file = path.join(home, 'config.toml');
  safePath(file);
  if (!existsSync(file)) return { text: readFileSync(path.join(source, 'config.toml'), 'utf8'), data: {}, existed: false };
  const text = readFileSync(file, 'utf8');
  return { text, data: parseToml(text), existed: true };
}
function validateManagedPaths({ source, host, home, previousHost, previousCodex, layaConfig, effectiveLaya, includeProjectDocs }) {
  const profile = hostProfile(host, home);
  const paths = new Set(previousHost);
  const runtime = path.join(home, 'open-spec-mesh', 'runtime');
  safePath(home); safePath(path.join(home, profile.rulesFile));
  safePath(path.join(home, 'skills')); safePath(path.join(home, 'agents'));
  safePath(path.join(home, 'open-spec-mesh')); safePath(runtime);
  if (hasPath(runtime)) {
    const marker = validateRuntimeOwnership(runtime, previousHost.has('open-spec-mesh/runtime'));
    if (!marker && previousHost.has('open-spec-mesh/runtime')) throw new Error('Runtime ownership is declared but its marker is missing');
  }
  const dispatch = path.join(home, 'open-spec-mesh', 'dispatch-contract.md');
  if (hasPath(dispatch) && !previousHost.has('open-spec-mesh/dispatch-contract.md')) throw new Error(`Unmanaged host artifact exists: open-spec-mesh/dispatch-contract.md`);
  const overlay = profile.mcpOverlay;
  if (overlay && hasPath(path.join(home, overlay)) && !previousHost.has(overlay)) throw new Error(`Unmanaged host artifact exists: ${overlay}`);
  if (host === 'codex') {
    for (const name of SKILLS.concat(effectiveLaya ? [LAYA_SKILL] : [])) {
      const target = path.join(home, 'skills', name); safePath(target);
      if (hasPath(target) && !previousCodex.skills.includes(name)) throw new Error(`Unmanaged skills/${name} exists; preserve it and choose another installation target`);
    }
    for (const role of ROLES) {
      const target = path.join(home, 'agents', `${role}.toml`); safePath(target);
      if (hasPath(target) && !Object.hasOwn(previousCodex.roles, role)) throw new Error(`Unmanaged agents/${role}.toml exists; refusing to overwrite it`);
    }
  } else {
    for (const name of SKILLS.concat(effectiveLaya ? [LAYA_SKILL] : [])) {
      const rel = `skills/${name}`; const target = path.join(home, rel); safePath(target);
      if (hasPath(target) && !paths.has(rel)) throw new Error(`Unmanaged host artifact exists: ${rel}`);
    }
    for (const role of ['main', ...ROLES]) {
      const rel = `agents/${role}.md`; const target = path.join(home, rel); safePath(target);
      if (hasPath(target) && !paths.has(rel)) throw new Error(`Unmanaged host artifact exists: ${rel}`);
    }
  }
  if (includeProjectDocs) {
    safePath(path.join(home, 'docs'));
    if (hasPath(path.join(home, 'docs')) && !paths.has('docs')) throw new Error('Unmanaged docs directory exists; choose another target or omit --include-project-docs');
  }
  const wrapper = path.join(home, 'mcp', 'laya_http_mcp.js');
  const settings = path.join(home, 'mcp', 'laya-settings.json');
  safePath(path.join(home, 'mcp')); safePath(wrapper); safePath(settings);
  const hasManagedLaya = Boolean(layaConfig && managedLayaConfig(layaConfig, home));
  if (hasPath(wrapper) && !paths.has('mcp/laya_http_mcp.js')) {
    const sourceWrapper = path.join(source, 'mcp', 'laya_http_mcp.js');
    if (!existsSync(sourceWrapper) || !readFileSync(wrapper).equals(readFileSync(sourceWrapper))) throw new Error('Unmanaged mcp/laya_http_mcp.js exists; refusing to overwrite it');
  }
  if (hasPath(settings) && !paths.has('mcp/laya-settings.json')) {
    let setting;
    try { setting = JSON.parse(readFileSync(settings, 'utf8')); } catch { throw new Error('Unmanaged mcp/laya-settings.json is invalid; refusing to overwrite it'); }
    if (!hasManagedLaya || !setting || Object.keys(setting).some((key) => key !== 'enabled') || typeof setting.enabled !== 'boolean') throw new Error('Unmanaged mcp/laya-settings.json exists; refusing to overwrite it');
  }
}

function roleDescription(source, role) {
  const data = parseToml(readFileSync(path.join(source, 'agents', `${role}.toml`), 'utf8'));
  return { description: data.description, config_file: `agents/${role}.toml` };
}

function mergeConfig(source, existingText, { previousCodex, toolCommands, effectiveLaya, withLaya, layaManaged, home, preserveExistingMcp = true, migrateLegacyAgentDefaults = false }) {
  let text = existingText;
  const existing = parseToml(text);
  const baseline = parseToml(readFileSync(path.join(source, 'config.toml'), 'utf8'));
  const retired = retirement(home, existing, previousCodex, effectiveLaya ? [...SKILLS, LAYA_SKILL] : [...SKILLS], ROLES);
  for (const role of retired.removedRoles) text = setTomlValue(text, ['agents', role], DELETE);
  const agents = existing.agents && typeof existing.agents === 'object' ? existing.agents : {};
  const features = existing.features && typeof existing.features === 'object' ? existing.features : {};
  const currentV2 = features.multi_agent_v2 && typeof features.multi_agent_v2 === 'object' ? features.multi_agent_v2 : {};
  let budget = currentV2.max_concurrent_threads_per_session;
  const validBudget = (value) => (Number.isSafeInteger(value) && value > 0) || (typeof value === 'bigint' && value > 0n);
  if (!validBudget(budget)) budget = agents.max_concurrent_threads_per_session ?? agents.max_threads;
  if (!validBudget(budget)) budget = baseline.features.multi_agent_v2.max_concurrent_threads_per_session;
  for (const obsolete of ['max_depth', 'max_threads', 'max_concurrent_threads_per_session']) text = setTomlValue(text, ['agents', obsolete], DELETE);
  const nextV2 = { ...baseline.features.multi_agent_v2, ...currentV2, max_concurrent_threads_per_session: budget };
  const updates = [
    [['features', 'multi_agent'], true],
    [['features', 'multi_agent_v2'], nextV2],
    [['agents', 'enabled'], true],
  ];
  if (!Object.hasOwn(existing, 'web_search')) updates.push([['web_search'], baseline.web_search]);
  if (!Object.hasOwn(agents, 'default_subagent_model') || (migrateLegacyAgentDefaults && agents.default_subagent_model === 'gpt-5.6-luna')) updates.push([['agents', 'default_subagent_model'], baseline.agents.default_subagent_model]);
  if (!Object.hasOwn(agents, 'default_subagent_reasoning_effort')) updates.push([['agents', 'default_subagent_reasoning_effort'], baseline.agents.default_subagent_reasoning_effort]);
  for (const [pathParts, value] of updates) text = setTomlValue(text, pathParts, value);

  const afterBase = parseToml(text);
  const servers = afterBase.mcp_servers && typeof afterBase.mcp_servers === 'object' ? afterBase.mcp_servers : {};
  for (const tool of RESEARCH_TOOLS) {
    const previous = preserveExistingMcp ? existing.mcp_servers?.[tool.server] : undefined;
    if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) throw new Error(`mcp_servers.${tool.server} must be a table`);
    let value = previous ? { ...previous } : { ...baseline.mcp_servers[tool.server] };
    const command = toolCommands?.[tool.server];
    if (command) {
      value.command = command;
      if (tool.server === 'codegraph') value.args = ['serve', '--mcp'];
      else delete value.args;
    }
    if (tool.keys.length && !Object.hasOwn(value, 'url') && typeof value.command === 'string') {
      const forwarded = value.env_vars ?? [];
      if (!Array.isArray(forwarded)) throw new Error(`mcp_servers.${tool.server}.env_vars must be a list`);
      value.env_vars = [...forwarded];
      for (const name of tool.keys) if (!value.env_vars.some((item) => item === name || (item && typeof item === 'object' && item.name === name))) value.env_vars.push(name);
    }
    if (JSON.stringify(previous) !== JSON.stringify(value)) text = setTomlValue(text, ['mcp_servers', tool.server], value);
  }

  const current = parseToml(text);
  const laya = current.mcp_servers?.laya;
  const previousLaya = preserveExistingMcp ? existing.mcp_servers?.laya : undefined;
  if (laya !== undefined && (!laya || typeof laya !== 'object' || Array.isArray(laya))) throw new Error('mcp_servers.laya must be a table');
  if (!layaManaged) {
    // A custom Laya endpoint, command, environment or authentication belongs to the user.
  } else if (effectiveLaya) {
    const beforeLaya = previousLaya;
    const next = { ...(beforeLaya && typeof beforeLaya === 'object' ? cleanLayaEnvironment(beforeLaya) : baseline.mcp_servers.laya), ...layaMcpConfig(home) };
    next.env_vars = [...new Set([...(beforeLaya?.env_vars ?? []), ...FORWARDED_ENV])];
    text = setTomlValue(text, ['mcp_servers', 'laya'], next);
  } else if (previousLaya && withLaya === false && (managedLayaConfig(previousLaya, home) || managedNodeLayaConfig(previousLaya, home))) {
    const next = { ...cleanLayaEnvironment(previousLaya), ...layaMcpConfig(home), enabled: false };
    next.env_vars = [...new Set([...(previousLaya.env_vars ?? []), ...FORWARDED_ENV])];
    text = setTomlValue(text, ['mcp_servers', 'laya'], next);
  } else if (!previousLaya) {
    // No prior managed bridge: don't publish an endpoint merely because the package baseline has one.
    text = setTomlValue(text, ['mcp_servers', 'laya'], DELETE);
  }

  for (const role of ROLES) {
    const old = parseToml(text).agents?.[role];
    const canonical = roleDescription(source, role);
    // Role selection descriptions are active prompts: refresh package-owned registrations
    // on upgrade, while preserving descriptions for unowned registrations.
    const managed = Object.hasOwn(previousCodex.roles, role);
    const description = managed ? canonical.description : old?.description ?? canonical.description;
    const next = old && typeof old === 'object' ? { ...old, description, config_file: canonical.config_file } : canonical;
    text = setTomlValue(text, ['agents', role], next);
  }
  return { text, retirement: retired };
}

function hostPaths(host, skills, includeProjectDocs, includeLayaFiles) {
  const profile = hostProfile(host, '/unused');
  const paths = new Set([
    'open-spec-mesh/runtime', 'open-spec-mesh/dispatch-contract.md',
    'open-spec-mesh/agents/index.md', 'open-spec-mesh/managed-host.json',
    ...skills.map((skill) => `skills/${skill}`),
  ]);
  if (host === 'codex') for (const role of ROLES) paths.add(`agents/${role}.toml`);
  else for (const role of ['main', ...ROLES]) paths.add(`agents/${role}.md`);
  if (profile.mcpOverlay) paths.add(profile.mcpOverlay);
  if (includeProjectDocs) paths.add('docs');
  if (includeLayaFiles) { paths.add('mcp/laya_http_mcp.js'); paths.add('mcp/laya-settings.json'); }
  return paths;
}

async function buildHostStage({ source, home, host, hostStage, runtimeRoot, runtimeFiles, toolCommands, layaManaged, effectiveLaya, withLaya, includeProjectDocs, codexText, codexConfigExisted, previousLaya, previousHost, migrateLegacyAgentDefaults = false }) {
  const profile = hostProfile(host, home); const skills = effectiveLaya ? [...SKILLS, LAYA_SKILL] : [...SKILLS];
  const extraPrompt = effectiveLaya ? LAYA_POLICY : '';
  const managedSkills = skills;
  const operations = [];
  const warnings = [];
  const skillFiles = new Set(runtimeFiles);
  const sourceRules = renderRules(runtimeRoot, host, home, { extraPrompt });
  const existingRulesPath = path.join(home, profile.rulesFile);
  const existingRules = existsSync(existingRulesPath) ? readFileSync(existingRulesPath, 'utf8') : '';
  const clean = cleanAgents(existingRules, sourceRules, catalog(runtimeRoot));
  writeStageFile(hostStage, profile.rulesFile, clean.text, 0o644);
  operations.push({ relative: profile.rulesFile, source: path.join(hostStage, profile.rulesFile) });

  const dispatchRelative = 'open-spec-mesh/dispatch-contract.md';
  writeStageFile(hostStage, dispatchRelative, renderDispatchContract(runtimeRoot, host, home), 0o644);
  operations.push({ relative: dispatchRelative, source: path.join(hostStage, dispatchRelative) });
  const roleIndex = readFileSync(path.join(runtimeRoot, 'agents/index.md'));
  writeStageFile(hostStage, 'open-spec-mesh/agents/index.md', roleIndex, 0o644);
  operations.push({ relative: 'open-spec-mesh/agents/index.md', source: path.join(hostStage, 'open-spec-mesh/agents/index.md') });

  for (const skill of managedSkills) {
    const sourceRelative = `${skill}/`;
    if (!runtimeFiles.some((file) => file.startsWith(sourceRelative))) throw new Error(`Runtime package is missing Skill assets: ${skill}`);
    const destination = path.join(hostStage, 'skills', skill);
    copyTree(path.join(runtimeRoot, skill), destination, {
      allow: (relative) => skillFiles.has(`${skill}/${relative}`),
      rewriteMarkdown: (text) => adaptSkillMarkdown(text, host, home),
    });
    operations.push({ relative: `skills/${skill}`, source: destination });
  }

  if (host === 'codex') {
    for (const role of ROLES) {
      const relative = `agents/${role}.toml`;
      const content = renderRole(runtimeRoot, host, role, home, { extraPrompt });
      writeStageFile(hostStage, relative, content, 0o644);
      operations.push({ relative, source: path.join(hostStage, relative) });
    }
    const manifestContent = manifestText(managedSkills, ROLES);
    writeStageFile(hostStage, MANIFEST, manifestContent, 0o600);
    operations.push({ relative: MANIFEST, source: path.join(hostStage, MANIFEST) });
    const config = mergeConfig(runtimeRoot, codexText, {
      previousCodex: readManifest(home), toolCommands, effectiveLaya, withLaya, layaManaged, home, preserveExistingMcp: codexConfigExisted, migrateLegacyAgentDefaults,
    });
    writeStageFile(hostStage, 'config.toml', config.text, 0o600);
    operations.push({ relative: 'config.toml', source: path.join(hostStage, 'config.toml') });
    for (const relative of config.retirement.paths) operations.push({ relative, source: null });
    warnings.push(...config.retirement.warnings);
    // A recognized legacy launch proves these package-owned Python client paths.
    // Custom or unregistered MCP files must not be deleted just by extension.
    if (codexConfigExisted && layaManaged && previousLaya?.args?.[0]?.endsWith('laya_http_mcp.py')) {
      const helpers = ['laya_http_mcp', 'laya_contracts', 'laya_runtime'];
      for (const helper of helpers) {
        for (const extension of ['py', 'pyc', 'pyo']) operations.push({ relative: 'mcp/' + helper + '.' + extension, source: null });
      }
      const cache = path.join(home, 'mcp', '__pycache__');
      if (hasPath(cache)) {
        safePath(cache);
        if (!lstatSync(cache).isDirectory()) throw new Error('Legacy MCP cache must be a real directory');
        for (const name of readdirSync(cache)) {
          if (/^(?:laya_http_mcp|laya_contracts|laya_runtime)\.[^.]+(?:\.opt-\d+)?\.py[co]$/u.test(name)) {
            operations.push({ relative: 'mcp/__pycache__/' + name, source: null });
          }
        }
      }
    }
  } else {
    const mainContent = renderMain(runtimeRoot, host, home, { extraPrompt });
    writeStageFile(hostStage, `agents/main.md`, mainContent, 0o644);
    operations.push({ relative: 'agents/main.md', source: path.join(hostStage, 'agents/main.md') });
    for (const role of ROLES) {
      const relative = `agents/${role}.md`;
      writeStageFile(hostStage, relative, renderRole(runtimeRoot, host, role, home, { extraPrompt }), 0o644);
      operations.push({ relative, source: path.join(hostStage, relative) });
    }
    const layaConfig = effectiveLaya ? layaMcpConfig(home) : null;
    const overlayText = renderMcpOverlay(host, toolCommands, { laya: layaConfig });
    if (host === 'opencode') {
      const data = JSON.parse(overlayText);
      data.default_agent = 'main';
      data.agent = renderOpenCodeAgentMap(runtimeRoot, home, { extraPrompt });
      writeStageFile(hostStage, profile.mcpOverlay, `${JSON.stringify(data, null, 2)}\n`, 0o644);
    } else writeStageFile(hostStage, profile.mcpOverlay, overlayText, 0o600);
    operations.push({ relative: profile.mcpOverlay, source: path.join(hostStage, profile.mcpOverlay) });
  }

  const shouldInstallLayaFiles = effectiveLaya || Boolean(previousLaya && layaManaged) || previousHost.has('mcp/laya_http_mcp.js') || previousHost.has('mcp/laya-settings.json');
  if (shouldInstallLayaFiles) {
    const wrapperSource = path.join(runtimeRoot, 'mcp/laya_http_mcp.js');
    if (!skillFiles.has('mcp/laya_http_mcp.js')) throw new Error('Runtime package is missing the System One Node wrapper');
    const wrapperTarget = writeStageFile(hostStage, 'mcp/laya_http_mcp.js', readFileSync(wrapperSource), 0o755);
    const settingsTarget = writeStageFile(hostStage, 'mcp/laya-settings.json', `${JSON.stringify({ enabled: effectiveLaya })}\n`, 0o600);
    operations.push({ relative: 'mcp/laya_http_mcp.js', source: wrapperTarget });
    operations.push({ relative: 'mcp/laya-settings.json', source: settingsTarget });
  }

  if (includeProjectDocs) {
    const docs = path.join(runtimeRoot, 'docs');
    if (!existsSync(docs)) throw new Error('Package artifact is missing project reference docs');
    const destination = path.join(hostStage, 'docs');
    copyTree(docs, destination);
    operations.push({ relative: 'docs', source: destination });
    writeStageFile(hostStage, 'open-spec-mesh/index.md', '# Open Spec Mesh 安装导航\n\n[运行时参考](runtime/index.md) · [项目资料](../docs/index.md)\n', 0o644);
    operations.push({ relative: 'open-spec-mesh/index.md', source: path.join(hostStage, 'open-spec-mesh/index.md') });
  }

  const managed = hostPaths(host, managedSkills, includeProjectDocs, shouldInstallLayaFiles);
  const obsolete = [...previousHost].filter((relative) => !managed.has(relative));
  for (const relative of obsolete) if (!operations.some((item) => item.relative === relative)) operations.push({ relative, source: null });
  // Retire only manifest-owned directories and preserve local edits before removal.
  for (const skill of ['sdd-change', 'sdd-requirements']) {
    const oldSkill = path.join(home, 'skills', skill);
    if (!hasPath(oldSkill)) continue;
    const retiring = operations.some((item) => item.relative === 'skills/' + skill && item.source === null);
    if (retiring) {
      safeTree(oldSkill);
      const zip = new JSZip();
      const visit = (directory, prefix = '') => {
        for (const name of readdirSync(directory).sort()) {
          const file = path.join(directory, name);
          const relative = prefix ? prefix + '/' + name : name;
          const stat = lstatSync(file);
          if (stat.isDirectory()) {
            zip.file(relative + '/', null, { dir: true, date: stat.mtime, unixPermissions: stat.mode });
            visit(file, relative);
          } else if (stat.isFile()) {
            zip.file(relative, readFileSync(file), { binary: true, date: stat.mtime, unixPermissions: stat.mode });
          } else throw new Error('Cannot safely archive retired skills/' + skill + ': ' + relative);
        }
      };
      visit(oldSkill);
      const relative = 'open-spec-mesh/retired-skills/' + skill + '-' + Date.now() + '-' + randomBytes(6).toString('hex') + '.zip';
      if (hasPath(targetPath(home, relative))) throw new Error('Retired skill archive already exists');
      const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
      const source = writeStageFile(hostStage, relative, bytes, 0o600);
      operations.unshift({ relative, source });
      warnings.push('Archived retired skills/' + skill + ' (including local edits) at ' + relative + '; not automatically cleaned up.');
    } else warnings.push('Retained unmanaged skills/' + skill + '; review it manually and use sdd-req / sdd-design / sdd-plan.');
  }
  return { operations, managedPaths: managed, warnings: [...clean.warnings, ...warnings] };
}

function assertUnmanagedRuntime(home, host, previousHost) {
  const runtime = path.join(home, 'open-spec-mesh', 'runtime');
  if (!hasPath(runtime)) return;
  const marker = validateRuntimeOwnership(runtime, previousHost.has('open-spec-mesh/runtime'));
  if (marker && !previousHost.has('open-spec-mesh/runtime')) throw new Error(`Runtime marker exists without matching ${host} ownership`);
}

function assertPackageRootAndHomeDisjoint(source, home) {
  if (isInside(source, home) || isInside(home, source)) throw new Error('Package source and host Home must be disjoint directories');
}

function currentConfigForOwnership(host, home, source) {
  if (host !== 'codex') return { text: '', data: {}, existed: false, laya: undefined };
  const current = readCodexConfig(home, source);
  const effective = current.existed ? current.data : {};
  return { ...current, laya: effective.mcp_servers?.laya };
}

async function installUnlocked({ source, home, host, dryRun, skipTools, includeProjectDocs, withLaya, reporter, env, npmPath, faultInjector, migrateLegacyAgentDefaults }) {
  const previousHost = readHostManifest(home, host);
  const previousCodex = readManifest(home);
  const currentConfig = currentConfigForOwnership(host, home, source);
  const layaManaged = managedLayaServer(currentConfig.laya, home);
  const effectiveLaya = Boolean(withLaya && layaManaged);
  if (withLaya && !layaManaged) reporter('  TOOL preserve custom mcp_servers.laya (not probed or modified)');
  if (!withLaya) reporter('  SYSTEM ONE disabled unless a previously managed endpoint is retained disabled');
  validateManagedPaths({ source, host, home, previousHost, previousCodex, layaConfig: currentConfig.laya, effectiveLaya, includeProjectDocs });
  assertUnmanagedRuntime(home, host, previousHost);

  compareLockBytes(source);
  const packageManifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const missingResearch = checkResearchKeys({
    env, required: !dryRun && !skipTools, reporter: dryRun || skipTools ? reporter : () => {},
  });
  if (effectiveLaya) checkSystemOneEnvironment({ required: !dryRun && !skipTools, reporter, env });
  else if (withLaya && !layaManaged) reporter('  SYSTEM ONE custom configuration preserved; package bridge remains disabled');
  if (skipTools) reporter('  WARNING tool installation skipped; host config references PATH commands');
  if (includeProjectDocs) reporter('  DOCS include complete package reference docs tree');
  else reporter('  DOCS runtime only; existing Home/docs left untouched');

  if (dryRun) {
    reporter(`  PLAN ${host} Home: ${home}`);
    reporter('  PLAN runtime: package files + npm-shrinkwrap locked dependencies');
    if (missingResearch.length) reporter(`  WARNING ${missingResearch.length} required Research key(s) are not verified in dry-run`);
    reporter('  dry-run: no target files changed; npm and endpoints were not called');
    return { warnings: [] };
  }

  const toolHome = path.join(home, 'open-spec-mesh');
  const createdParents = ensureExistingParent(home);
  let transaction; let retainRecovery = false;
  try {
    return await withInstallLock(home, async () => {
      // Refresh ownership and path facts after lock acquisition; no target is modified before this point.
      const lockedPreviousHost = readHostManifest(home, host);
      const lockedPreviousCodex = readManifest(home);
      const lockedConfig = currentConfigForOwnership(host, home, source);
      const lockedLayaManaged = managedLayaServer(lockedConfig.laya, home);
      const lockedEffectiveLaya = Boolean(withLaya && lockedLayaManaged);
      validateManagedPaths({ source, host, home, previousHost: lockedPreviousHost, previousCodex: lockedPreviousCodex, layaConfig: lockedConfig.laya, effectiveLaya: lockedEffectiveLaya, includeProjectDocs });
      assertUnmanagedRuntime(home, host, lockedPreviousHost);
      const toolHome = path.join(home, 'open-spec-mesh');
      let toolCommands;
      if (skipTools) toolCommands = Object.fromEntries(RESEARCH_TOOLS.map(({ server, binary }) => [server, binary]));
      else {
        const toolConfig = lockedConfig.existed ? lockedConfig.data : parseToml(readFileSync(path.join(source, 'config.toml'), 'utf8'));
        toolCommands = ensureResearchTools(toolHome, { dryRun: false, installTools: true, reporter, env, npmPath, configData: toolConfig });
      }
      if (host !== 'codex' && skipTools) toolCommands = Object.fromEntries(RESEARCH_TOOLS.map(({ server, binary }) => [server, binary]));
      transaction = createTransaction(home);
      const runtimeStage = path.join(transaction.stage, 'open-spec-mesh/runtime');
      mkdirSync(path.dirname(runtimeStage), { recursive: true, mode: 0o700 });
      const builtRuntime = await buildRuntimeStage(source, runtimeStage, { host, withLaya: lockedEffectiveLaya, npmPath, env, reporter });
      const hostStage = path.join(transaction.stage, '.host-assets');
      mkdirSync(hostStage, { recursive: true, mode: 0o700 });
      const merged = lockedConfig.existed ? lockedConfig.text : readFileSync(path.join(source, 'config.toml'), 'utf8');
      const stage = await buildHostStage({
        source, home, host, hostStage, runtimeRoot: builtRuntime.root, runtimeFiles: builtRuntime.files,
        toolCommands: skipTools && host === 'codex' ? null : toolCommands,
        layaManaged: lockedLayaManaged, effectiveLaya: lockedEffectiveLaya, withLaya,
        includeProjectDocs, codexText: merged, codexConfigExisted: lockedConfig.existed, previousLaya: lockedConfig.laya, previousHost: lockedPreviousHost, migrateLegacyAgentDefaults,
      });
      stage.operations.unshift({ relative: 'open-spec-mesh/runtime', source: runtimeStage });
      const finalHostPaths = new Set([...stage.managedPaths]);
      finalHostPaths.add(HOST_MANIFEST);
      writeStageFile(hostStage, HOST_MANIFEST, hostManifestText(host, finalHostPaths), 0o600);
      stage.operations.push({ relative: HOST_MANIFEST, source: path.join(hostStage, HOST_MANIFEST) });
      const warningList = [...stage.warnings];
      const oldPipRuntime = path.join(home, '.open-spec-mesh-tools/laya/python');
      if (hasPath(oldPipRuntime)) warningList.push(`Retained legacy Python MCP runtime without proven ownership: ${oldPipRuntime}`);
      try { commitTransaction({ home, transaction, operations: stage.operations, faultInjector, reporter }); }
      catch (error) {
        if (error?.recoveryPath === transaction.root) retainRecovery = true;
        throw error;
      }
      transaction = null;
      reporter(`  RUNTIME ${packageManifest.version}; locked dependencies installed in Home-owned runtime`);
      reporter(`  OWNERSHIP manifest updated for ${host}`);
      return { warnings: warningList };
    });
  } finally {
    if (transaction && !retainRecovery) {
      try { rmSync(transaction.root, { recursive: true, force: true }); }
      catch (error) { reporter(`WARNING temporary stage cleanup failed: ${transaction.root}: ${error.message}`); }
    } else if (transaction && retainRecovery) {
      reporter(`WARNING recovery data retained at ${transaction.root}`);
    }
    removeEmptyParents(createdParents);
  }
}

export async function installHost(options) {
  const source = path.resolve(options.source ?? resolveRuntime(import.meta.url).packageRoot);
  const host = options.host ?? 'codex';
  if (!HOSTS.includes(host)) throw new Error(`Unknown host: ${host}`);
  assertNodeEngine(options.nodeVersion ?? process.versions.node);
  compareLockBytes(source);
  if (options.migrateLegacyAgentDefaults && host !== 'codex') throw new Error('--migrate-legacy-agent-defaults only supports codex');
  const home = safeHome(options.home ?? hostProfile(host).home);
  assertPackageRootAndHomeDisjoint(source, home);
  return installUnlocked({
    source, home, host, dryRun: Boolean(options.dryRun), skipTools: Boolean(options.skipTools),
    includeProjectDocs: Boolean(options.includeProjectDocs), withLaya: Boolean(options.withLaya),
    reporter: options.reporter ?? (() => {}), env: options.env ?? process.env,
    npmPath: options.npmPath, faultInjector: options.faultInjector, migrateLegacyAgentDefaults: Boolean(options.migrateLegacyAgentDefaults),
  });
}

export const INSTALL_USAGE = [
  'Usage: open-spec-mesh install [options]',
  '',
  'Options:',
  '  --host <codex|opencode|claude>  Host to configure (default: codex)',
  '  --host-home <path>               Override the selected host Home',
  '  --codex-home <path>              Backward-compatible Codex Home',
  '  --dry-run                        Report the plan without writes or installs',
  '  --skip-tools                     Skip Research tool installation',
  '  --migrate-legacy-agent-defaults  Explicitly migrate only the old gpt-5.6-luna subagent default; preserve other overrides',
  '  --include-project-docs           Replace the package-owned reference docs',
  '  --with-laya | --without-laya     Enable or disable optional System One',
  '  -h, --help                       Show this help',
  '',
].join('\n');

export function parseInstallArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const result = { host: 'codex', hostHome: null, codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), dryRun: false, skipTools: false, includeProjectDocs: false, withLaya: false, migrateLegacyAgentDefaults: false };
  let sawLaya = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1; return next;
    };
    if (arg === '--host') result.host = value();
    else if (arg === '--host-home') result.hostHome = value();
    else if (arg === '--codex-home') result.codexHome = value();
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--skip-tools') result.skipTools = true;
    else if (arg === '--migrate-legacy-agent-defaults') result.migrateLegacyAgentDefaults = true;
    else if (arg === '--include-project-docs') result.includeProjectDocs = true;
    else if (arg === '--with-laya' || arg === '--without-laya') {
      if (sawLaya) throw new Error('--with-laya and --without-laya are mutually exclusive');
      sawLaya = true; result.withLaya = arg === '--with-laya';
    } else throw new Error(`Unknown install option: ${arg}`);
  }
  if (!HOSTS.includes(result.host)) throw new Error(`--host must be one of: ${HOSTS.join(', ')}`);
  if (result.hostHome !== null) result.home = path.resolve(result.hostHome);
  else if (result.host === 'codex') result.home = path.resolve(result.codexHome);
  else result.home = hostProfile(result.host).home;
  return result;
}

export async function runInstall(argv = process.argv.slice(2), streams = {}) {
  const stdout = streams.stdout ?? process.stdout; const stderr = streams.stderr ?? process.stderr;
  let options;
  try { options = parseInstallArgs(argv); }
  catch (error) { stderr.write(`install: ${error.message}\n`); return 2; }
  if (options.help) { stdout.write(INSTALL_USAGE); return 0; }
  const reporter = (line) => stdout.write(`${line}\n`);
  try {
    const result = await installHost({ ...options, source: streams.runtime?.packageRoot ?? resolveRuntime(import.meta.url).packageRoot, reporter });
    reporter(`${options.dryRun ? 'preview' : 'installed'}: ${options.home}`);
    if (!options.dryRun) reporter(`managed files replaced; no persistent backup; installed-file state only: reload configuration in the actual ${options.host} host and verify dispatch; existing sessions are not proven updated`);
    for (const warning of result.warnings) stderr.write(`WARNING ${warning}\n`);
    return 0;
  } catch (error) {
    stderr.write(`install failed: ${error.message}\n`);
    return 1;
  }
}

export const INSTALL_INTERNALS = Object.freeze({
  nodeVersionTuple, assertNodeEngine, isInside, mergeConfig, buildHostStage,
  validateManagedPaths, packageAssetFilter, hostPaths, safeHome, targetPath,
});
