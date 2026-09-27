"""Validate native Multi-Agent V2 role routing against a deterministic local provider.

Uses the real Codex CLI but no paid/remote model calls. Verifies V2 tool shape,
configured agent_type routing, model/reasoning application, and Architect -> Explorer.
It does not prove model quality, billing, production provider compatibility, or OS ACLs.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
import tomllib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
ROLES = ('architect', 'worker', 'reviewer', 'explorer', 'librarian')


def tool_defs(request):
    defs = list(request.get('tools', []))
    for item in request.get('input', []):
        if isinstance(item, dict) and item.get('type') == 'additional_tools':
            defs.extend(item.get('tools', []))
    return defs


def walk_tools(items, namespace=None):
    for item in items:
        if item.get('type') == 'namespace':
            child_namespace = item.get('name') or namespace
            yield from walk_tools(item.get('tools', []), child_namespace)
        else:
            yield item, namespace


def tool_names(request):
    names = []
    for item, namespace in walk_tools(tool_defs(request)):
        name = item.get('name')
        if not name:
            continue
        names.append(f'{namespace}.{name}' if namespace else name)
    return names


def find_tool(request, name):
    for item, namespace in walk_tools(tool_defs(request)):
        if item.get('name') == name:
            return item, namespace
    return None, None


def marker(request):
    raw = json.dumps(request.get('input', []), ensure_ascii=False)
    match = re.search(r'SDD_PROBE_(ROOT|CHILD|NESTED):([a-z]+)', raw)
    return match.groups() if match else (None, None)


def response(item):
    rid = 'fixture_' + str(time.time_ns())
    frames = [
        {'type': 'response.created', 'response': {'id': rid}},
        {'type': 'response.output_item.done', 'item': item},
        {'type': 'response.completed', 'response': {'id': rid}},
    ]
    return ''.join('event: ' + frame['type'] + '\ndata: ' + json.dumps(frame) + '\n\n' for frame in frames).encode()


def message(text):
    return {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': text}]}


def spawn_call(task_name, role, prompt, namespace=None):
    item = {
        'type': 'function_call',
        'call_id': 'spawn_' + task_name + '_' + str(time.time_ns()),
        'name': 'spawn_agent',
        'arguments': json.dumps({
            'task_name': task_name,
            'agent_type': role,
            'fork_turns': 'none',
            'message': prompt,
        }),
    }
    if namespace:
        item['namespace'] = namespace
    return item


def fixture_catalog():
    common = {
        'description': 'Deterministic GPT-6 V2 CI fixture',
        'base_instructions': 'You are a deterministic Codex CI fixture. Follow the task and use available tools.',
        'support_verbosity': True,
        'default_verbosity': 'low',
        'apply_patch_tool_type': 'freeform',
        'web_search_tool_type': 'text_and_image',
        'input_modalities': ['text'],
        'supports_image_detail_original': False,
        'truncation_policy': {'mode': 'tokens', 'limit': 10000},
        'supports_parallel_tool_calls': True,
        'tool_mode': 'direct',
        'multi_agent_version': 'v2',
        'use_responses_lite': False,
        'context_window': 272000,
        'max_context_window': 872000,
        'default_reasoning_summary': 'none',
        'shell_type': 'shell_command',
        'visibility': 'list',
        'minimal_client_version': '0.154.0',
        'supported_in_api': True,
        'availability_nux': None,
        'upgrade': None,
        'experimental_supported_tools': [],
        'supports_reasoning_summary_parameter': True,
        'supports_reasoning_summaries': True,
    }

    def model(slug, display_name, efforts, priority):
        return {
            **common,
            'slug': slug,
            'display_name': display_name,
            'default_reasoning_level': 'medium',
            'supported_reasoning_levels': [
                {'effort': effort, 'description': effort} for effort in efforts
            ],
            'priority': priority,
        }

    return {'models': [
        model('gpt-6-luna', 'GPT-6-Luna', ['low', 'medium', 'high', 'xhigh', 'max'], 1),
        model('gpt-6-sol', 'GPT-6-Sol', ['low', 'medium', 'high', 'xhigh', 'max'], 2),
    ]}


def run_probe():
    binary = shutil.which('codex')
    if not binary:
        raise SystemExit('Codex missing; runtime validation has NOT run')
    version = subprocess.check_output([binary, '--version'], text=True).strip()
    print(version, flush=True)

    observed = {}
    root_tools = {}
    events = {role: threading.Event() for role in (*ROLES, 'nested')}
    stages = {}
    errors = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"object":"list","data":[],"models":[]}')

        def do_POST(self):
            try:
                request = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
                kind, role = marker(request)
                if not kind:
                    data = response(message('SDD_AUX_OK'))
                else:
                    names = tool_names(request)
                    effort = request.get('reasoning', {}).get('effort')
                    key = (kind, role)
                    if kind == 'ROOT':
                        root_tools[role] = names
                        schema, namespace = find_tool(request, 'spawn_agent')
                        if schema is None:
                            raise ValueError('V2 spawn_agent tool is not visible; tools=' + str(names))
                        if namespace != 'agents':
                            raise ValueError('Unexpected V2 tool namespace: ' + str(namespace))
                        params = schema.get('parameters', {}).get('properties', {})
                        required = {'task_name', 'message', 'fork_turns', 'agent_type'}
                        if not required <= set(params):
                            raise ValueError('V2 spawn_agent missing configured-role fields: ' + str(sorted(params)))
                        if 'model' in params or 'reasoning_effort' in params:
                            raise ValueError('Spawn-time model overrides must stay hidden; role TOML owns routing')
                        if request.get('model') != 'gpt-6-luna' or effort != 'max':
                            raise ValueError('Root must run Luna 6 max')
                        if stages.get(key) != 'spawned':
                            stages[key] = 'spawned'
                            data = response(spawn_call(
                                'probe_' + role,
                                role,
                                'SDD_PROBE_CHILD:' + role,
                                namespace,
                            ))
                        else:
                            if not events[role].wait(25):
                                raise ValueError('Child did not finish: ' + role)
                            data = response(message('SDD_ROOT_OK'))
                    elif kind == 'CHILD':
                        observed[role] = {'model': request.get('model'), 'effort': effort, 'tools': names}
                        if role == 'architect' and stages.get(key) != 'spawned':
                            spawn, namespace = find_tool(request, 'spawn_agent')
                            if spawn is None:
                                raise ValueError('Architect cannot access native V2 spawn_agent; tools=' + str(names))
                            stages[key] = 'spawned'
                            data = response(spawn_call(
                                'probe_nested_explorer',
                                'explorer',
                                'SDD_PROBE_NESTED:explorer',
                                namespace,
                            ))
                        else:
                            if role == 'architect' and not events['nested'].wait(25):
                                raise ValueError('Nested Explorer not observed')
                            events[role].set()
                            data = response(message('SDD_CHILD_OK'))
                    else:
                        observed['nested'] = {'model': request.get('model'), 'effort': effort, 'tools': names}
                        events['nested'].set()
                        data = response(message('SDD_NESTED_OK'))

                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as exc:
                errors.append(str(exc))
                self.send_error(500, str(exc))

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='sdd-codex-', dir=Path.home()) as tmp:
            home = Path(tmp)/'codex'
            project = Path(tmp)/'project'
            home.mkdir()
            project.mkdir()
            (home/'agents').mkdir()

            catalog_path = home/'model-catalog.json'
            catalog_path.write_text(json.dumps(fixture_catalog()), encoding='utf-8')
            config = f'''model_provider = "fixture"
model = "gpt-6-luna"
model_reasoning_effort = "max"
model_catalog_json = "{catalog_path.as_posix()}"
approval_policy = "never"

[model_providers.fixture]
name = "Local deterministic fixture"
base_url = "http://127.0.0.1:{server.server_port}/v1"
wire_api = "responses"
env_key = "SDD_FIXTURE_KEY"
request_max_retries = 0
stream_max_retries = 0

[features]
multi_agent = true

[features.multi_agent_v2]
enabled = true
tool_namespace = "agents"
max_concurrent_threads_per_session = 4
hide_spawn_agent_metadata = false
expose_spawn_agent_model_overrides = false
wait_agent_enabled = true

[analytics]
enabled = false

[agents]
enabled = true
default_subagent_model = "gpt-6-luna"
default_subagent_reasoning_effort = "max"
'''
            for role in ROLES:
                shutil.copy2(ROOT/'agents'/f'{role}.toml', home/'agents'/f'{role}.toml')
                config += f'\n[agents.{role}]\ndescription="Probe {role}"\nconfig_file="agents/{role}.toml"\n'
            (home/'config.toml').write_text(config)

            env = dict(os.environ, CODEX_HOME=str(home), SDD_FIXTURE_KEY='not-a-real-api-key')
            env.pop('OPENAI_API_KEY', None)
            for role in ROLES:
                result = subprocess.run(
                    [binary, 'exec', '--json', '--skip-git-repo-check', '-C', str(project),
                     '--sandbox', 'workspace-write', 'SDD_PROBE_ROOT:' + role],
                    env=env,
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=100,
                )
                if result.returncode or role not in observed:
                    raise RuntimeError(
                        f'{role}: {result.returncode}; errors={errors}; '
                        f'{result.stdout[-3500:]}; {result.stderr[-1500:]}'
                    )

            for label, actual in observed.items():
                role = 'explorer' if label == 'nested' else label
                expected = tomllib.loads((ROOT/'agents'/f'{role}.toml').read_text())
                assert actual['model'] == expected['model'], (label, actual)
                assert actual['effort'] == expected['model_reasoning_effort'], (label, actual)

            assert 'nested' in observed, 'Architect -> Explorer V2 path was not exercised'
            assert all('agents.spawn_agent' in root_tools[role] for role in ROLES)
    finally:
        server.shutdown()
        server.server_close()

    print(json.dumps({
        'client': version,
        'provider': 'local deterministic fixture, NOT live models',
        'backend': 'multi-agent-v2',
        'observed': observed,
    }, indent=2))


if __name__ == '__main__':
    run_probe()
