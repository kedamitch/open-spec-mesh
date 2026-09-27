"""Data-only decision contracts. No model calls, dispatch or permission grants."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import tomllib
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
MODELS = {'english', 'multilingual', 'typed-decisions'}
PROVIDERS = {'laya', 'jev'}
SINGLE_PATH = '/v1/systemone'
BATCH_PATH = '/v1/systemone/batch'
MODELS_PATH = '/v1/models'
TYPESAFE_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
TYPESAFE_DEFAULT_MODEL = 'jev-latest'
LAYA_REQUIRED_ENV = ('LAYA_BASE_URL', 'LAYA_API_KEY')
TYPESAFE_REQUIRED_ENV = ('TYPESAFE_API_KEY',)
OPTIONAL_ENV = (
    'SYSTEMONE_PROVIDER', 'SYSTEMONE_TIMEOUT_SECONDS',
    'SYSTEMONE_MODEL_REVISION', 'SYSTEMONE_METRICS_PATH',
    'LAYA_MODEL', 'LAYA_MODEL_REVISION', 'LAYA_TIMEOUT_SECONDS',
    'LAYA_TEMPLATE_DIR', 'LAYA_METRICS_PATH',
    'TYPESAFE_BASE_URL', 'TYPESAFE_DEFAULT_MODEL',
)
FORWARDED_ENV = (
    'SYSTEMONE_PROVIDER', 'SYSTEMONE_TIMEOUT_SECONDS',
    'SYSTEMONE_MODEL_REVISION', 'SYSTEMONE_METRICS_PATH',
    'LAYA_BASE_URL', 'LAYA_API_KEY', 'LAYA_MODEL', 'LAYA_MODEL_REVISION',
    'LAYA_TIMEOUT_SECONDS', 'LAYA_TEMPLATE_DIR', 'LAYA_METRICS_PATH',
    'TYPESAFE_API_KEY', 'TYPESAFE_BASE_URL', 'TYPESAFE_DEFAULT_MODEL',
)
MAX_ITEMS = 16
MAX_REQUEST = 128 * 1024
MAX_STATE = 4096  # characters, NOT tokenizer tokens; the server checks the actual budget
ID = re.compile(r'([a-z][a-z0-9-]{0,63})@([1-9][0-9]{0,3})\Z')
ROLES = {'main', 'worker', 'architect', 'explorer', 'librarian', 'reviewer'}


def encode(value) -> bytes:
    # Preserve option and state field order: Laya options/token budgets are positional.
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()


def resolve_provider(env=None):
    env = os.environ if env is None else env
    explicit = env.get('SYSTEMONE_PROVIDER', '').strip().lower()
    if not explicit:
        return 'laya'
    if explicit not in PROVIDERS:
        raise ValueError('SYSTEMONE_PROVIDER must be laya or jev')
    return explicit


def _validate_base(base, name):
    try:
        u = urlsplit(base)
        valid = (u.scheme in ('http', 'https') and u.hostname and not u.username and not u.password
                 and not u.query and not u.fragment and (u.port is None or 0 < u.port < 65536)
                 and not any(ch.isspace() or ord(ch) < 32 for ch in base) and '\\' not in base)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError(f'{name} must be an absolute http(s) URL without credentials, query or fragment')
    return base.rstrip('/')


def _validate_key(key, name):
    if not key or any(ord(ch) < 33 or ord(ch) > 126 for ch in key):
        raise ValueError(f'{name} must be a printable ASCII token without whitespace')
    return key


def validate_model(provider, model):
    if not isinstance(model, str):
        raise ValueError('model must be a string')
    model = model.strip()
    if not model or len(model) > 128 or any(ord(ch) < 33 or ord(ch) > 126 for ch in model):
        raise ValueError('model must be a nonempty printable ASCII identifier')
    if provider == 'laya' and model not in MODELS:
        raise ValueError('LAYA_MODEL must name a supported checkpoint')
    return model


def provider_config(env=None):
    env = os.environ if env is None else env
    provider = resolve_provider(env)
    if provider == 'laya':
        missing = [name for name in LAYA_REQUIRED_ENV if not env.get(name, '').strip()]
        if missing:
            raise ValueError('Missing required environment variables: ' + ', '.join(missing))
        base = _validate_base(env['LAYA_BASE_URL'].strip(), 'LAYA_BASE_URL')
        key = _validate_key(env['LAYA_API_KEY'].strip(), 'LAYA_API_KEY')
        model = validate_model('laya', env.get('LAYA_MODEL', 'multilingual').strip() or 'multilingual')
        timeout_raw = env.get('SYSTEMONE_TIMEOUT_SECONDS', '').strip() or env.get('LAYA_TIMEOUT_SECONDS', '5')
    else:
        missing = [name for name in TYPESAFE_REQUIRED_ENV if not env.get(name, '').strip()]
        if missing:
            raise ValueError('Missing required environment variables: ' + ', '.join(missing))
        base = _validate_base(env.get('TYPESAFE_BASE_URL', TYPESAFE_DEFAULT_BASE_URL).strip() or TYPESAFE_DEFAULT_BASE_URL,
                              'TYPESAFE_BASE_URL')
        key = _validate_key(env['TYPESAFE_API_KEY'].strip(), 'TYPESAFE_API_KEY')
        model = validate_model('jev', env.get('TYPESAFE_DEFAULT_MODEL', TYPESAFE_DEFAULT_MODEL).strip()
                               or TYPESAFE_DEFAULT_MODEL)
        timeout_raw = env.get('SYSTEMONE_TIMEOUT_SECONDS', '').strip() or '10'
    try:
        timeout = float(timeout_raw)
    except ValueError:
        raise ValueError('SYSTEMONE_TIMEOUT_SECONDS must be between 0.1 and 60') from None
    if not math.isfinite(timeout) or not 0.1 <= timeout <= 60:
        raise ValueError('SYSTEMONE_TIMEOUT_SECONDS must be between 0.1 and 60')
    return {'provider': provider, 'base': base, 'key': key, 'model': model, 'timeout': timeout}


def config(env=None):
    cfg = provider_config(env)
    return cfg['base'], cfg['key'], cfg['model'], cfg['timeout']


def model_revision(provider, env=None):
    env = os.environ if env is None else env
    generic = env.get('SYSTEMONE_MODEL_REVISION', '').strip()
    if generic:
        return generic
    return env.get('LAYA_MODEL_REVISION', '').strip() if provider == 'laya' else ''


def metrics_path(env=None):
    env = os.environ if env is None else env
    return env.get('SYSTEMONE_METRICS_PATH', '').strip() or env.get('LAYA_METRICS_PATH', '').strip()


def validate_questions(questions):
    if not isinstance(questions, dict) or not 1 <= len(questions) <= 8:
        raise ValueError('questions must contain 1-8 typed judgments')
    for name, q in questions.items():
        if not isinstance(name, str) or not name or not isinstance(q, dict):
            raise ValueError('invalid question name or definition')
        if not isinstance(q.get('instructions'), str) or not q['instructions'].strip():
            raise ValueError('instructions must be a nonempty string')
        kind, c = q.get('type'), q.get('criteria')
        if kind == 'choice':
            if not isinstance(c, (dict, list)) or not 1 <= len(c) <= 20:
                raise ValueError('choice requires 1-20 candidates')
            if any(not isinstance(k, str) or not k.strip() for k in c) or len(set(c)) != len(c):
                raise ValueError('choice labels must be unique nonempty strings')
            if isinstance(c, dict) and any(v is not None and not isinstance(v, str) for v in c.values()):
                raise ValueError('choice descriptions must be strings or null')
        elif kind == 'score':
            if not isinstance(c, list) or not 2 <= len(c) <= 20 or any(not isinstance(v, str) or not v.strip() for v in c):
                raise ValueError('score requires 2-20 ordered descriptions')
        elif kind == 'noul':
            if c is not None and (not isinstance(c, dict) or not set(c) <= {'true', 'false'}
                                  or any(not isinstance(v, str) for v in c.values())):
                raise ValueError('noul criteria use true/false string descriptions')
        else:
            raise ValueError('unknown question type')
    if len(encode(questions)) > 16384:
        raise ValueError('question schema too large')


def validate_provider_questions(provider, questions):
    validate_questions(questions)
    if provider == 'jev':
        for question in questions.values():
            if question.get('type') == 'score' and len(question.get('criteria', [])) > 10:
                raise ValueError('Jev score requires at most 10 ordered descriptions')


def validate_answers(result, questions):
    answers = result.get('answers') if isinstance(result, dict) else None
    if not isinstance(answers, dict):
        raise ValueError('missing answers')
    clean = {}
    for name, q in questions.items():
        a, kind = answers.get(name), q['type']
        if not isinstance(a, dict) or a.get('type') != kind:
            raise ValueError('missing or mismatched answer')
        value = a.get(kind)
        if kind == 'choice':
            if not isinstance(value, str) or value not in q['criteria']:
                raise ValueError('unknown answer candidate')
        else:
            maximum = len(q['criteria']) - 1 if kind == 'score' else 1
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
                raise ValueError('invalid numeric answer')
        clean[name] = {'type': kind, kind: value}
        # Only validated probability fields, never arbitrary upstream prose/metadata.
        for field in ('confidence', 'answer_confidence'):
            v = a.get(field)
            if type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1:
                clean[name][field] = v
        probs = a.get('probabilities')
        if kind in ('choice', 'score') and isinstance(probs, dict):
            labels = list(q['criteria']) if kind == 'choice' else [str(i) for i in range(len(q['criteria']))]
            if set(probs) == set(labels) and all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in probs.values()):
                if abs(sum(probs.values()) - 1) < .02:
                    clean[name]['probabilities'] = {k: probs[k] for k in labels}
    return clean


def read_template(path):
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('template symlinks are not allowed')
    if path.stat().st_size > 65536:
        raise ValueError('template too large')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict) or not ID.fullmatch(value.get('id', '')):
        raise ValueError('invalid template ID')
    if not isinstance(value.get('description'), str):
        raise ValueError('template needs a description')
    fields = value.get('required_fields')
    if not isinstance(fields, list) or not fields or any(not isinstance(f, str) or not f for f in fields):
        raise ValueError('required_fields must be a nonempty list of field names')
    validate_questions(value.get('questions'))
    value['digest'] = hashlib.sha256(encode(value)).hexdigest()
    return value


def load_template(decision):
    if not isinstance(decision, str) or not (match := ID.fullmatch(decision)):
        raise ValueError('decision must be name@version')
    name = f'{match[1]}.v{match[2]}.json'
    built = HERE/'templates'/name
    path = built
    if not built.exists():
        directory = os.environ.get('LAYA_TEMPLATE_DIR')
        if not directory or not Path(directory).is_absolute():
            raise ValueError('unknown decision; custom templates require an absolute LAYA_TEMPLATE_DIR')
        path = Path(directory)/name
    value = read_template(path)
    if value['id'] != decision:
        raise ValueError('template ID does not match filename')
    return value


def list_templates():
    result, seen = [], set()
    directories = [HERE/'templates']
    extra = os.environ.get('LAYA_TEMPLATE_DIR')
    if extra:
        if not Path(extra).is_absolute():
            raise ValueError('LAYA_TEMPLATE_DIR must be absolute')
        directories.append(Path(extra))
    for directory in directories:
        for path in sorted(directory.glob('*.json'))[:64]:
            value = read_template(path)
            if value['id'] not in seen:
                seen.add(value['id'])
                result.append({k: value[k] for k in ('id', 'description', 'required_fields')})
    return result


def _permitted_roles(state):
    actor = state.get('current_role')
    mode = state.get('execution_mode', 'quick')
    if actor == 'main':
        allowed = {'explorer', 'librarian'}
        if mode == 'sdd':
            allowed.add('architect')
            if state.get('task_graph_ready') is True:
                allowed.add('worker')
                if state.get('reviewer_requested') is True:
                    allowed.add('reviewer')
    elif actor == 'architect' and mode == 'sdd':
        allowed = {'explorer', 'librarian'}
    else:
        allowed = set()
    seen = set()
    return [role for role in state.get('available_roles', [])
            if role in allowed and not (role in seen or seen.add(role))]


def _role_descriptions(roles):
    result = {}
    root = HERE.parent/'agents'
    for role in roles:
        path = root/f'{role}.toml'
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024:
            raise ValueError('managed role description unavailable')
        try:
            data = tomllib.loads(path.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, tomllib.TOMLDecodeError):
            raise ValueError('managed role description unavailable') from None
        description = data.get('description')
        if data.get('name') != role or not isinstance(description, str) or not description.strip():
            raise ValueError('managed role description unavailable')
        result[role] = description.strip()
    return result


def prepare_state(template, state):
    if not isinstance(state, dict):
        raise ValueError('state must be an object')
    state = dict(state)
    # Human-facing role/mode names are case-insensitive. Normalize before validation
    # so natural inputs such as "Main", " Explorer " or "SDD" do not fail locally.
    if template['id'] == 'execution-mode@1' and isinstance(state.get('existing_mode'), str):
        state['existing_mode'] = state['existing_mode'].strip().lower()
    if template['id'] == 'delegation@1':
        if isinstance(state.get('current_role'), str):
            state['current_role'] = state['current_role'].strip().lower()
        if isinstance(state.get('available_roles'), list):
            state['available_roles'] = [
                role.strip().lower() if isinstance(role, str) else role
                for role in state['available_roles']
            ]
        mode = state.get('execution_mode', 'quick')
        state['execution_mode'] = mode.strip().lower() if isinstance(mode, str) else mode
    if any(f not in state for f in template['required_fields']):
        raise ValueError('required state fields missing')
    if 'request' in template['required_fields'] and (not isinstance(state['request'], str) or not state['request'].strip()):
        raise ValueError('request must be nonempty text')
    if template['id'] == 'delegation@1':
        actor, available = state.get('current_role'), state.get('available_roles')
        mode = state.get('execution_mode')
        if not isinstance(actor, str) or actor not in ROLES or not isinstance(available, list) or any(not isinstance(r, str) or r not in ROLES for r in available):
            raise ValueError('delegation needs current_role and available_roles')
        if mode not in {'quick', 'sdd'}:
            raise ValueError('delegation execution_mode must be quick or sdd')
        # Only structurally permitted candidates reach the model. Their real
        # descriptions are injected directly into the executor Choice below.
        state['available_roles'] = _permitted_roles(state)
    if len(encode(state).decode()) > MAX_STATE:
        raise ValueError('state too large; do not summarize only to call Laya')
    return state


def prepare_questions(template, state):
    """Build the effective typed questions for one prepared state."""
    if template['id'] != 'delegation@1':
        return template['questions']
    actor = state['current_role']
    executor = dict(template['questions']['executor'])
    if actor == 'main':
        actor_description = template['questions']['executor']['criteria']['main']
    else:
        actor_description = _role_descriptions([actor])[actor]
    criteria = {actor: actor_description}
    criteria.update(_role_descriptions(state.get('available_roles', [])))
    criteria['uncertain'] = template['questions']['executor']['criteria']['uncertain']
    executor['criteria'] = criteria
    hints = [
        '只在当前角色和 state.available_roles 中选择；候选已由运行时按当前角色权限和状态过滤。',
        '每个候选项的 criteria 文本就是该角色对当前调用方可见的职责描述。',
        '不要推断、讨论或选择未出现在候选中的其他角色。',
        '已有证据足够且当前角色能直接完成时，优先保持当前上下文，避免无收益委派。',
    ]
    available = set(state.get('available_roles', []))
    if 'explorer' in available:
        hints.append('未知本地实现、调用链、状态、数据、测试或部署事实时，可优先 Explorer。')
    if 'librarian' in available:
        hints.append('未知外部文档、版本、协议、SDK 或供应商当前事实时，可优先 Librarian。')
    executor['instructions'] = ''.join(hints)
    questions = {'executor': executor}
    validate_questions(questions)
    return questions


def guard(template, state, answers):
    """Normalize advice against structural constraints; this is not authentication."""
    recommendation = {n: a[a['type']] for n, a in answers.items()}
    if template['id'] == 'execution-mode@1':
        existing = state.get('existing_mode')
        if existing in ('quick', 'sdd'):
            recommendation['mode'] = existing
    if template['id'] == 'delegation@1':
        actor = state['current_role']
        executor = recommendation.get('executor')
        if executor == 'uncertain':
            return None
        permitted = {actor, *_permitted_roles(state)}
        if executor not in permitted:
            return None
        return {'executor': executor}
    if 'uncertain' in recommendation.values():
        return None
    return recommendation
