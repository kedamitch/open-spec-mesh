import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { HOSTS, ROLES, hostProfile, renderMcpOverlay, renderOpenCodeAgentMap, renderRole } from '../../../lib/installation/host-adapter.js';
import { managedLayaConfig, managedNodeLayaConfig } from '../../../lib/installation/systemone-config.js';
import { REPO_ROOT } from './helpers.js';

test('host profiles retain canonical host-specific locations', () => {
  assert.deepEqual(HOSTS, ['codex', 'opencode', 'claude']);
  assert.equal(hostProfile('codex', '/tmp/codex').rulesFile, 'AGENTS.md');
  assert.equal(hostProfile('opencode', '/tmp/opencode').mcpOverlay, 'open-spec-mesh.opencode.json');
  assert.equal(hostProfile('claude', '/tmp/claude').mcpOverlay, 'open-spec-mesh.mcp.json');
  assert.throws(() => hostProfile('unsupported', '/tmp/host'), /Unknown host/);
});

test('Claude native MCP overlay uses literal environment placeholders and no provider calls', () => {
  const output = renderMcpOverlay('claude', { codegraph: 'codegraph', context7: 'context7-mcp', tavily: 'tavily-mcp' }, {
    laya: { command: 'node', args: ['/tmp/home/mcp/laya_http_mcp.js'], env_vars: ['LAYA_BASE_URL', 'LAYA_API_KEY'] },
  });
  const data = JSON.parse(output);
  assert.equal(data.mcpServers.laya.command, 'node');
  assert.deepEqual(data.mcpServers.laya.args, ['/tmp/home/mcp/laya_http_mcp.js']);
  assert.deepEqual(data.mcpServers.laya.env, { LAYA_BASE_URL: '${LAYA_BASE_URL}', LAYA_API_KEY: '${LAYA_API_KEY}' });
  assert.equal(output.includes('\u001b'), false);
  assert.equal(output.includes('undefined'), false);
});

test('Codex role rendering preserves canonical identity, model and effort', () => {
  for (const role of ROLES) {
    const rendered = renderRole(REPO_ROOT, 'codex', role, '/tmp/codex');
    assert.equal(rendered.includes(`name = "${role}"`), true);
    assert.equal(rendered.includes('model ='), true);
    assert.equal(rendered.includes('reasoning_effort ='), true);
  }
});

test('legacy and Node System One launch forms are recognized without claiming custom endpoints', () => {
  const home = path.resolve('/tmp/host home');
  assert.equal(managedLayaConfig({ command: 'python3', args: ['mcp/laya_http_mcp.py'] }, home), true);
  const node = { command: 'node', args: [path.join(home, 'mcp/laya_http_mcp.js')] };
  assert.equal(managedLayaConfig(node, home), true);
  assert.equal(managedNodeLayaConfig(node, home), true);
  assert.equal(managedLayaConfig({ url: 'https://custom.invalid/mcp', headers: { Authorization: 'env:USER_TOKEN' } }, home), false);
});


test('non-Codex role adapters retain least-privilege permissions and inherit host models', () => {
  const reviewer = renderRole(REPO_ROOT, 'claude', 'reviewer', '/tmp/claude');
  assert.match(reviewer, /model: inherit/);
  assert.match(reviewer, /tools: Read, Bash, Glob, Grep, Skill/);
  assert.equal(reviewer.includes('Write'), false);
  const architect = renderRole(REPO_ROOT, 'opencode', 'architect', '/tmp/opencode');
  assert.match(architect, /explorer: allow/);
  assert.match(architect, /librarian: allow/);
  assert.match(architect, /\"\*\": deny/);
  assert.equal(architect.includes('worker: allow'), false);
});


test('OpenCode uses V1 input fields and preserves prompts, native role permissions and model inheritance', () => {
  const agents = renderOpenCodeAgentMap(REPO_ROOT, '/tmp/opencode');
  assert.equal(agents.main.mode, 'primary');
  assert.match(agents.main.prompt, /role_desc/);
  assert.deepEqual(agents.main.permission.task, { '*': 'deny', ...Object.fromEntries(ROLES.map((role) => [role, 'allow'])) });
  assert.deepEqual(agents.architect.permission.task, { '*': 'deny', explorer: 'allow', librarian: 'allow' });
  for (const [role, agent] of Object.entries(agents)) {
    assert.equal(Object.hasOwn(agent, 'system'), false);
    assert.equal(Object.hasOwn(agent, 'permissions'), false);
    assert.equal(Object.hasOwn(agent, 'model'), false);
    if (role !== 'main') assert.equal(agent.mode, 'subagent');
    if (['reviewer', 'explorer', 'librarian'].includes(role)) assert.equal(agent.permission.edit, 'deny');
    if (!['main', 'architect'].includes(role)) assert.deepEqual(agent.permission.task, { '*': 'deny' });
  }
  const overlay = JSON.parse(renderMcpOverlay('opencode', { codegraph: 'codegraph', context7: 'context7-mcp', tavily: 'tavily-mcp' }));
  assert.deepEqual(Object.keys(overlay.mcp), ['codegraph', 'context7', 'tavily']);
  assert.deepEqual(overlay.mcp.codegraph.command, ['codegraph', 'serve', '--mcp']);
  assert.equal(overlay.mcp.context7.environment.CONTEXT7_API_KEY, '{env:CONTEXT7_API_KEY}');
});
