import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseToml, setTomlValue } from './toml.js';

export const HOSTS = Object.freeze(['codex', 'opencode', 'claude']);
export const ROLES = Object.freeze(['architect', 'worker', 'reviewer', 'explorer', 'librarian']);
export const LEAF_ROLES = Object.freeze(['worker', 'reviewer', 'explorer', 'librarian']);

export function defaultHome(host, env = process.env) {
  const home = env.HOME || os.homedir();
  if (host === 'codex') return path.resolve(env.CODEX_HOME || path.join(home, '.codex'));
  if (host === 'opencode') return path.resolve(env.OPENCODE_CONFIG_DIR || path.join(home, '.config', 'opencode'));
  if (host === 'claude') return path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
  throw new Error(`Unknown host: ${host}`);
}

export function hostProfile(host, home, env = process.env) {
  if (!HOSTS.includes(host)) throw new Error(`Unknown host: ${host}`);
  const root = path.resolve(home ?? defaultHome(host, env));
  if (host === 'codex') return Object.freeze({ name: host, home: root, rulesFile: 'AGENTS.md', skillsDir: 'skills', agentsDir: 'agents', cli: 'codex', nativeTrace: true, mcpOverlay: null });
  if (host === 'opencode') return Object.freeze({ name: host, home: root, rulesFile: 'AGENTS.md', skillsDir: 'skills', agentsDir: 'agents', cli: 'opencode', nativeTrace: false, mcpOverlay: 'open-spec-mesh.opencode.json' });
  return Object.freeze({ name: host, home: root, rulesFile: 'CLAUDE.md', skillsDir: 'skills', agentsDir: 'agents', cli: 'claude', nativeTrace: false, mcpOverlay: 'open-spec-mesh.mcp.json' });
}

export function loadRole(source, role) {
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  const data = parseToml(readFileSync(path.join(source, 'agents', `${role}.toml`), 'utf8'));
  if (!data || data.name !== role || typeof data.description !== 'string' || typeof data.developer_instructions !== 'string') {
    throw new Error(`Invalid canonical role: ${role}`);
  }
  return data;
}

function skillNote(profile) {
  if (profile.name === 'codex') return `Skill 根为 ${path.join(profile.home, 'skills')}/。`;
  const label = profile.name === 'opencode' ? 'OpenCode' : 'Claude Code';
  return `Skill 使用 ${label} 原生 discovery；全局 Skill 根为 ${path.join(profile.home, 'skills')}/。`;
}

function adaptPrompt(text, profile) {
  const dispatch = path.join(profile.home, 'open-spec-mesh', 'dispatch-contract.md');
  text = text.replace(/Skill 根为 \$CODEX_HOME\/skills\/（缺省 ~\/\.codex\/skills\/）。/gu, skillNote(profile));
  text = text.replaceAll('$CODEX_HOME/agents/dispatch-contract.md', dispatch);
  text = text.replaceAll('agents/dispatch-contract.md', dispatch);
  text = text.replaceAll('- Skill 根：`$CODEX_HOME/skills/`。', `- ${skillNote(profile)}`);
  text = text.replaceAll('- Skill 入口：由 Host Adapter 映射到当前宿主的原生 Skill 根。', `- ${skillNote(profile)}`);
  const roleRoute = '- Agent 路由：由 Host Adapter 映射；角色语义、人工确认与安全边界不因宿主变化。';
  if (profile.name === 'opencode') {
    text = text.replaceAll(roleRoute, '- Agent：使用 OpenCode 原生 primary/subagent 与 subagent 权限；角色语义和人工阶段确认不变。');
    text = text.replaceAll('- V2：`agent_type` + `fork_turns="none"`；model / effort 由角色 TOML 固定。', '- Agent：使用 OpenCode 原生 primary/subagent 与 subagent tool；model/provider 继承用户宿主配置。');
    text = text.replaceAll('使用 agent_type + fork_turns="none"，不覆盖 model / effort。', '使用 OpenCode 原生 subagent tool 调用命名 subagent；不在派发时覆盖用户 model/provider。');
  } else if (profile.name === 'claude') {
    text = text.replaceAll(roleRoute, '- Agent：使用 Claude Code 原生 Agent/subagent；角色语义和人工阶段确认不变。');
    text = text.replaceAll('使用 agent_type + fork_turns="none"，不覆盖 model / effort。', '使用 Claude Code 原生 Agent tool 调用命名 subagent；不在派发时覆盖用户 model/provider。');
    text = text.replaceAll('- V2：`agent_type` + `fork_turns="none"`；model / effort 由角色 TOML 固定。', '- Agent：使用 Claude Code 原生 Agent/subagent；model/provider 继承用户宿主配置。');
  }
  return text;
}

const yaml = (value) => JSON.stringify(value);
function allowedAgents(role) { return role === 'main' ? ROLES : role === 'architect' ? ['explorer', 'librarian'] : []; }
function opencodePermissions(role) {
  const lines = ['permission:', '  task:', '    "*": deny', ...allowedAgents(role).map((name) => `    ${name}: allow`)];
  if (['reviewer', 'explorer', 'librarian'].includes(role)) lines.push('  edit: deny');
  return lines;
}
function opencodePermissionMap(role) {
  const permission = { task: { '*': 'deny', ...Object.fromEntries(allowedAgents(role).map((name) => [name, 'allow'])) } };
  if (['reviewer', 'explorer', 'librarian'].includes(role)) permission.edit = 'deny';
  return permission;
}

// Target the installed "opencode" CLI's V1 input schema, not opencode2.
export function renderOpenCodeAgentMap(source, home, { extraPrompt = '' } = {}) {
  const profile = hostProfile('opencode', home);
  const result = { main: {
    description: 'Open Spec Mesh Main：Quick/SDD 人工阶段、串行实现、并行集成与真实验证。',
    mode: 'primary',
    prompt: adaptPrompt(readFileSync(path.join(source, 'AGENTS.md'), 'utf8') + extraPrompt, profile).trim(),
    permission: opencodePermissionMap('main'),
  } };
  for (const role of ROLES) {
    const item = loadRole(source, role);
    result[role] = { description: item.description, mode: 'subagent', prompt: adaptPrompt(item.developer_instructions + extraPrompt, profile).trim(), permission: opencodePermissionMap(role) };
  }
  return result;
}

export function renderMain(source, host, home, { extraPrompt = '' } = {}) {
  const profile = hostProfile(host, home);
  const sourceText = readFileSync(path.join(source, 'AGENTS.md'), 'utf8');
  if (host === 'codex') return sourceText;
  const prompt = adaptPrompt(sourceText + extraPrompt, profile);
  const description = 'Open Spec Mesh Main：Quick/SDD 人工阶段、串行实现、并行集成与真实验证。';
  const front = host === 'opencode'
    ? ['---', `description: ${yaml(description)}`, 'mode: primary', ...opencodePermissions('main'), '---']
    : ['---', 'name: main', `description: ${yaml(description)}`, 'model: inherit', 'tools: Agent(architect, worker, reviewer, explorer, librarian), Read, Write, Edit, Bash, Glob, Grep, Skill, WebFetch, WebSearch', '---'];
  return `${front.join('\n')}\n\n${prompt.trimEnd()}\n`;
}

export function renderRole(source, host, role, home, { extraPrompt = '' } = {}) {
  const profile = hostProfile(host, home);
  const item = loadRole(source, role);
  if (host === 'codex') {
    const text = readFileSync(path.join(source, 'agents', `${role}.toml`), 'utf8');
    return extraPrompt ? setTomlValue(text, ['developer_instructions'], item.developer_instructions + extraPrompt) : text;
  }
  const prompt = adaptPrompt(item.developer_instructions + extraPrompt, profile);
  let front;
  if (host === 'opencode') front = ['---', `description: ${yaml(item.description)}`, 'mode: subagent', ...opencodePermissions(role), '---'];
  else {
    const tools = {
      architect: 'Agent(explorer, librarian), Read, Write, Edit, Bash, Glob, Grep, Skill, WebFetch, WebSearch',
      worker: 'Read, Write, Edit, Bash, Glob, Grep, Skill',
      reviewer: 'Read, Bash, Glob, Grep, Skill',
      explorer: 'Read, Bash, Glob, Grep, Skill',
      librarian: 'Read, Bash, Glob, Grep, Skill, WebFetch, WebSearch',
    }[role];
    front = ['---', `name: ${role}`, `description: ${yaml(item.description)}`, 'model: inherit', `tools: ${tools}`, '---'];
  }
  return `${front.join('\n')}\n\n${prompt.trim()}\n`;
}

export function renderRules(source, host, home, { extraPrompt = '' } = {}) {
  const profile = hostProfile(host, home);
  let text = adaptPrompt(readFileSync(path.join(source, 'AGENTS.md'), 'utf8') + extraPrompt, profile);
  if (host === 'claude') text = `# Open Spec Mesh\n\nThis file is the Claude Code host adapter for the shared Open Spec Mesh rules.\n\n${text}`;
  return `${text.trimEnd()}\n`;
}

export function adaptSkillMarkdown(text, host, home) {
  const profile = hostProfile(host, home);
  if (host === 'codex') return text;
  const root = path.join(profile.home, 'skills');
  return text
    .replaceAll('安装后使用 `$CODEX_HOME/skills/` 下对应脚本。', `安装后使用 \`${root}/\` 下对应脚本。`);
}

export function renderDispatchContract(source, host, home) {
  return `${adaptPrompt(readFileSync(path.join(source, 'agents', 'dispatch-contract.md'), 'utf8'), hostProfile(host, home)).trimEnd()}\n`;
}

export function renderMcpOverlay(host, commands, { laya } = {}) {
  const required = ['codegraph', 'context7', 'tavily'];
  const missing = required.filter((name) => !commands[name]);
  if (missing.length) throw new Error(`Missing research tool commands: ${missing.sort().join(', ')}`);
  if (host === 'opencode') {
    const servers = {
      codegraph: { type: 'local', command: [commands.codegraph, 'serve', '--mcp'] },
      context7: { type: 'local', command: [commands.context7], environment: { CONTEXT7_API_KEY: '{env:CONTEXT7_API_KEY}' } },
      tavily: { type: 'local', command: [commands.tavily], environment: { TAVILY_API_KEY: '{env:TAVILY_API_KEY}' } },
    };
    if (laya) servers.laya = { type: 'local', command: [laya.command, ...(laya.args ?? [])], environment: Object.fromEntries((laya.env_vars ?? []).map((name) => [name, `{env:${name}}`])) };
    return `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: servers }, null, 2)}\n`;
  }
  if (host === 'claude') {
    const servers = {
      codegraph: { type: 'stdio', command: commands.codegraph, args: ['serve', '--mcp'] },
      context7: { type: 'stdio', command: commands.context7, args: [], env: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}' } },
      tavily: { type: 'stdio', command: commands.tavily, args: [], env: { TAVILY_API_KEY: '${TAVILY_API_KEY}' } },
    };
    if (laya) servers.laya = { type: 'stdio', command: laya.command, args: [...(laya.args ?? [])], env: Object.fromEntries((laya.env_vars ?? []).map((name) => [name, '$' + `{${name}}`])) };
    return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
  }
  throw new Error('MCP overlay is only used for opencode/claude');
}

export function nativeArtifactPaths(host, home) {
  const profile = hostProfile(host, home);
  const result = { rules: path.join(profile.home, profile.rulesFile), skills: path.join(profile.home, profile.skillsDir), agents: path.join(profile.home, profile.agentsDir), dispatch: path.join(profile.home, 'open-spec-mesh', 'dispatch-contract.md') };
  if (profile.mcpOverlay) result.mcp_overlay = path.join(profile.home, profile.mcpOverlay);
  return result;
}
