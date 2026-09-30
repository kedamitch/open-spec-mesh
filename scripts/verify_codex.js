#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToml } from '../lib/installation/toml.js';
import { resolveExecutable } from '../lib/installation/tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLES = ['architect', 'worker', 'reviewer', 'explorer', 'librarian'];

function toolDefs(request) {
  const definitions = [...(Array.isArray(request.tools) ? request.tools : [])];
  for (const item of request.input ?? []) if (item?.type === 'additional_tools') definitions.push(...(item.tools ?? []));
  return definitions;
}
function walkTools(items, namespace = null, output = []) {
  for (const item of items) {
    if (item?.type === 'namespace') walkTools(item.tools ?? [], item.name || namespace, output);
    else output.push({ item, namespace });
  }
  return output;
}
function findTool(request, name) { return walkTools(toolDefs(request)).find(({ item }) => item.name === name) ?? { item: null, namespace: null }; }
function toolNames(request) {
  return walkTools(toolDefs(request)).filter(({ item }) => item?.name)
    .map(({ item, namespace }) => namespace ? `${namespace}.${item.name}` : item.name);
}
function requestMarker(request) {
  const text = JSON.stringify(request.input ?? []);
  const match = text.match(/SDD_PROBE_(ROOT|CHILD|NESTED):([a-z]+)/u);
  return match ? [match[1], match[2]] : [null, null];
}
function sse(item) {
  const id = `fixture_${process.hrtime.bigint()}`;
  const frames = [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { id } },
  ];
  return Buffer.from(frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''));
}
function message(text) { return { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }; }
function spawnCall(taskName, role, prompt, namespace) {
  const item = {
    type: 'function_call', call_id: `spawn_${taskName}_${process.hrtime.bigint()}`, name: 'spawn_agent',
    arguments: JSON.stringify({ task_name: taskName, agent_type: role, fork_turns: 'none', message: prompt }),
  };
  if (namespace) item.namespace = namespace;
  return item;
}
export function fixtureCatalog() {
  const common = {
    description: 'Deterministic GPT-6 V2 CI fixture',
    base_instructions: 'You are a deterministic Codex CI fixture. Follow the task and use available tools.',
    support_verbosity: true, default_verbosity: 'low', apply_patch_tool_type: 'freeform', web_search_tool_type: 'text_and_image',
    input_modalities: ['text'], supports_image_detail_original: false, truncation_policy: { mode: 'tokens', limit: 10000 },
    supports_parallel_tool_calls: true, tool_mode: 'direct', multi_agent_version: 'v2', use_responses_lite: false,
    context_window: 272000, max_context_window: 872000, default_reasoning_summary: 'none', shell_type: 'shell_command',
    visibility: 'list', minimal_client_version: '0.154.0', supported_in_api: true, availability_nux: null, upgrade: null,
    experimental_supported_tools: [], supports_reasoning_summary_parameter: true, supports_reasoning_summaries: true,
  };
  const model = (slug, display_name, priority) => ({
    ...common, slug, display_name, default_reasoning_level: 'medium',
    supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => ({ effort, description: effort })),
    priority,
  });
  return { models: [model('gpt-6-luna', 'GPT-6-Luna', 1), model('gpt-6.1-sol', 'GPT-6.1-Sol', 2)] };
}
function waitFor(promise, ms, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} not observed within ${ms}ms`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
function runProcess(command, args, { cwd, env, timeout = 100_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    let stdout = ''; let stderr = ''; let timer;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code: code ?? 1, signal, stdout, stderr }); });
    timer = setTimeout(() => { child.kill('SIGKILL'); }, timeout);
  });
}

export async function verifyCodex() {
  const binary = resolveExecutable('codex');
  if (!binary) throw new Error('Codex missing; native runtime validation has NOT run');
  const versionResult = await runProcess(binary, ['--version'], { cwd: ROOT, env: process.env, timeout: 20_000 });
  if (versionResult.code !== 0) throw new Error(`Codex --version failed: ${versionResult.stderr.slice(-2000)}`);
  process.stdout.write(`Codex: ${versionResult.stdout.trim()}\n`);

  const observed = Object.create(null); const rootTools = Object.create(null);
  const stages = new Map(); const errors = [];
  const signals = new Map([...ROLES, 'nested'].map((role) => [role, { promise: null, resolve: null }]));
  for (const [role, signal] of signals) signal.promise = new Promise((resolve) => { signal.resolve = resolve; });
  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"object":"list","data":[],"models":[]}');
      return;
    }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const [kind, role] = requestMarker(body);
      let payload;
      if (!kind) payload = sse(message('SDD_AUX_OK'));
      else {
        const names = toolNames(body);
        const effort = body.reasoning?.effort;
        const key = `${kind}:${role}`;
        if (kind === 'ROOT') {
          rootTools[role] = names;
          const { item: spawnTool, namespace } = findTool(body, 'spawn_agent');
          if (!spawnTool) throw new Error(`V2 spawn_agent tool is not visible: ${names.join(', ')}`);
          if (namespace !== 'agents') throw new Error(`Unexpected V2 tool namespace: ${namespace}`);
          const params = spawnTool.parameters?.properties ?? {};
          for (const required of ['task_name', 'message', 'fork_turns', 'agent_type']) if (!Object.hasOwn(params, required)) throw new Error(`V2 spawn_agent missing ${required}`);
          if (Object.hasOwn(params, 'model') || Object.hasOwn(params, 'reasoning_effort')) throw new Error('Spawn-time model overrides must stay hidden');
          if (body.model !== 'gpt-6-luna' || effort !== 'max') throw new Error('Root must run Luna 6 max');
          if (stages.get(key) !== 'spawned') {
            stages.set(key, 'spawned');
            payload = sse(spawnCall(`${role}_native_probe`, role, `SDD_PROBE_CHILD:${role}`, namespace));
          } else {
            await waitFor(signals.get(role).promise, 25_000, `Child ${role}`);
            payload = sse(message('SDD_ROOT_OK'));
          }
        } else if (kind === 'CHILD') {
          observed[role] = { model: body.model, effort, tools: names };
          if (role === 'architect' && stages.get(key) !== 'spawned') {
            const { item: spawnTool, namespace } = findTool(body, 'spawn_agent');
            if (!spawnTool) throw new Error(`Architect cannot access V2 spawn_agent: ${names.join(', ')}`);
            stages.set(key, 'spawned');
            payload = sse(spawnCall('explorer_nested_probe', 'explorer', 'SDD_PROBE_NESTED:explorer', namespace));
          } else {
            if (role === 'architect') await waitFor(signals.get('nested').promise, 25_000, 'Nested Explorer');
            signals.get(role).resolve();
            payload = sse(message('SDD_CHILD_OK'));
          }
        } else {
          observed.nested = { model: body.model, effort, tools: names };
          signals.get('nested').resolve();
          payload = sse(message('SDD_NESTED_OK'));
        }
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'content-length': payload.length });
      response.end(payload);
    } catch (error) {
      errors.push(error.message);
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end(error.message);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const temp = fs.mkdtempSync(path.join(os.homedir(), 'osm-codex-probe-'));
  try {
    const home = path.join(temp, 'codex'); const project = path.join(temp, 'project');
    fs.mkdirSync(path.join(home, 'agents'), { recursive: true }); fs.mkdirSync(project);
    const catalog = path.join(home, 'model-catalog.json');
    fs.writeFileSync(catalog, JSON.stringify(fixtureCatalog()));
    let config = `model_provider = "fixture"\nmodel = "gpt-6-luna"\nmodel_reasoning_effort = "max"\nmodel_catalog_json = ${JSON.stringify(catalog)}\napproval_policy = "never"\n\n[model_providers.fixture]\nname = "Local deterministic fixture"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nenv_key = "SDD_FIXTURE_KEY"\nrequest_max_retries = 0\nstream_max_retries = 0\n\n[features]\nmulti_agent = true\n\n[features.multi_agent_v2]\nenabled = true\ntool_namespace = "agents"\nmax_concurrent_threads_per_session = 4\nhide_spawn_agent_metadata = false\nexpose_spawn_agent_model_overrides = false\nwait_agent_enabled = true\n\n[analytics]\nenabled = false\n\n[agents]\nenabled = true\ndefault_subagent_model = "gpt-6-luna"\ndefault_subagent_reasoning_effort = "max"\n`;
    for (const role of ROLES) {
      const bytes = fs.readFileSync(path.join(ROOT, 'agents', `${role}.toml`));
      fs.writeFileSync(path.join(home, 'agents', `${role}.toml`), bytes);
      config += `\n[agents.${role}]\ndescription = "Probe ${role}"\nconfig_file = "agents/${role}.toml"\n`;
    }
    fs.writeFileSync(path.join(home, 'config.toml'), config);
    const env = { ...process.env, CODEX_HOME: home, SDD_FIXTURE_KEY: 'not-a-real-api-key' };
    delete env.OPENAI_API_KEY;
    for (const role of ROLES) {
      const result = await runProcess(binary, ['exec', '--json', '--skip-git-repo-check', '-C', project, '--sandbox', 'workspace-write', `SDD_PROBE_ROOT:${role}`], { cwd: ROOT, env, timeout: 110_000 });
      if (result.code !== 0 || !Object.hasOwn(observed, role)) throw new Error(`${role}: exit=${result.code}; errors=${errors.join('; ')}; stdout=${result.stdout.slice(-3500)}; stderr=${result.stderr.slice(-1500)}`);
    }
    for (const [label, actual] of Object.entries(observed)) {
      const role = label === 'nested' ? 'explorer' : label;
      const expected = parseToml(fs.readFileSync(path.join(ROOT, 'agents', `${role}.toml`), 'utf8'));
      assert.equal(actual.model, expected.model, `${label} model route`);
      assert.equal(actual.effort, expected.model_reasoning_effort, `${label} effort route`);
    }
    assert.ok(Object.hasOwn(observed, 'nested'), 'Architect -> Explorer V2 path was not exercised');
    for (const role of ROLES) assert.ok(rootTools[role]?.includes('agents.spawn_agent'), `${role} did not expose native agents.spawn_agent`);
    process.stdout.write(`${JSON.stringify({ client: versionResult.stdout.trim(), provider: 'local deterministic fixture; no remote models', backend: 'multi-agent-v2', observed }, null, 2)}\n`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyCodex().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
