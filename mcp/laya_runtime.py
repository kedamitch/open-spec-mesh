"""Reusable decisions: bounded HTTP, true-batch protocol, process cache and fallback."""
from __future__ import annotations

from collections import OrderedDict
import hashlib
import json
import os
from pathlib import Path
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, HTTPRedirectHandler, build_opener

from laya_contracts import (BATCH_PATH, SINGLE_PATH, MODELS_PATH, HERE, MAX_ITEMS, MAX_REQUEST, MODELS,
                            provider_config, validate_model, model_revision, metrics_path, encode, load_template,
                            prepare_state, prepare_questions, guard, validate_questions,
                            validate_provider_questions, validate_answers)


class ServiceError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def enabled():
    try:
        path = HERE/'laya-settings.json'
        if path.is_symlink() or path.stat().st_size > 1024:
            return False
        return json.loads(path.read_text()).get('enabled') is True
    except (OSError, ValueError, AttributeError):
        return False


def http_json(method, path, body=None):
    cfg = provider_config()
    base, key, timeout = cfg['base'], cfg['key'], cfg['timeout']
    payload = None if body is None else encode(body)
    if payload is not None and len(payload) > MAX_REQUEST:
        raise ValueError('request_too_large')
    headers = {'Accept': 'application/json', 'Authorization': 'Bearer ' + key}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = Request(base+path, data=payload, headers=headers, method=method)
    try:
        with build_opener(NoRedirect()).open(req, timeout=timeout) as response:
            raw = response.read(1024*1024+1)
    except HTTPError as error:
        code = error.code
        error.close()
        raise ServiceError(f'http_{code}') from None
    except (URLError, TimeoutError, OSError):
        raise ServiceError('unavailable_or_timeout') from None
    if len(raw) > 1024*1024:
        raise ServiceError('response_too_large')
    try:
        return json.loads(raw.decode())
    except (ValueError, UnicodeError):
        raise ServiceError('invalid_json') from None


def fallback(reason, item_id=None):
    out = {'status': 'fallback', 'fallback': 'current_actor', 'reason': reason}
    if item_id is not None:
        out['id'] = item_id
    return out


def metric(event):
    """Opt-in metadata only. Observability failure cannot change a decision."""
    target = metrics_path()
    if not target:
        return None
    try:
        p = Path(target)
        if not p.is_absolute() or any(x.is_symlink() for x in (p, *p.parents)):
            return False
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(p, os.O_APPEND | os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(encode(event).decode()+'\n')
        return True
    except (OSError, ValueError):
        return False


class Runtime:
    def __init__(self, transport=http_json, clock=time.monotonic):
        self.transport, self.clock = transport, clock
        self.cache = OrderedDict()
        self.lock = threading.RLock()
        self.failure = None  # (endpoint identity, safe reason); explicit health resets it

    def status(self):
        if not enabled():
            return {'status': 'disabled'}
        with self.lock:
            try:
                cfg = provider_config()
                if cfg['provider'] == 'laya':
                    result = self.transport('GET', '/health')
                    if not isinstance(result, dict) or result.get('status') != 'ok':
                        return fallback('invalid_health')
                    loaded = result.get('loaded', [])
                    out = {'status': 'ok', 'provider': 'laya',
                           'loaded': [x for x in loaded if isinstance(x, str) and x in MODELS] if isinstance(loaded, list) else [],
                           'health_only': True}
                else:
                    result = self.transport('GET', MODELS_PATH)
                    if not isinstance(result, (dict, list)):
                        return fallback('invalid_models')
                    out = {'status': 'ok', 'provider': 'jev', 'models_only': True}
                self.failure = None
                self.cache.clear()
                return out
            except (ServiceError, ValueError):
                return fallback('service_unavailable')

    def _predict_requests(self, requests, provider):
        if provider == 'laya':
            # A single input is still one batch item; never fall back to the legacy endpoint.
            result = self.transport('POST', BATCH_PATH, {'requests': requests})
            if isinstance(result, list):
                results = result
            elif isinstance(result, dict):
                results = result.get('results')
            else:
                results = None
            if not isinstance(results, list) or len(results) != len(requests):
                raise ServiceError('batch_alignment_error')
            return results
        # TypeSafe Jev exposes the official System One single-request endpoint.
        results = []
        for request in requests:
            result = self.transport('POST', SINGLE_PATH, request)
            if not isinstance(result, dict):
                raise ServiceError('invalid_response')
            results.append(result)
        return results

    def run(self, decision, items, context=None, model='auto'):
        started = self.clock()
        if not enabled():
            return fallback('disabled')
        try:
            t = load_template(decision)
            if (context is not None and not isinstance(context, dict)) or not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
                raise ValueError('invalid batch')
            ids, states = [], []
            for item in items:
                if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not 1 <= len(item['id']) <= 128:
                    raise ValueError('invalid item ID')
                if item['id'] in ids or not isinstance(item.get('state'), dict):
                    raise ValueError('duplicate ID or invalid state')
                ids.append(item['id'])
                states.append(prepare_state(t, {**(context or {}), **item['state']}))
            if len(encode(states)) > MAX_REQUEST:
                raise ValueError('batch too large')
            cfg = provider_config()
            provider, base, key = cfg['provider'], cfg['base'], cfg['key']
            model = cfg['model'] if model in ('auto', '') else validate_model(provider, model)
            questions_by_state = [prepare_questions(t, state) for state in states]
            for questions in questions_by_state:
                validate_provider_questions(provider, questions)
        except (OSError, TypeError, ValueError):
            return fallback('invalid_configuration_or_input')
        # No reuse across unpinned model deployments, endpoint/key scope, effective
        # question schema or state changes.
        revision = model_revision(provider)
        transport_path = BATCH_PATH if provider == 'laya' else SINGLE_PATH
        identity = hashlib.sha256(encode([provider, base, key, model, revision, transport_path])).hexdigest()
        scope = hashlib.sha256(encode([provider, base, key])).hexdigest()
        keys = [
            hashlib.sha256(encode([identity, t['digest'], state, questions])).hexdigest()
            for state, questions in zip(states, questions_by_state)
        ]
        rows = [None] * len(items)
        requests, request_keys, request_questions, locations = [], [], [], {}
        cache_hits = network_calls = 0
        backend = 'none'
        with self.lock:
            # Exact same input within this call is deduplicated even with persistent caching off.
            for i, (state, questions, cache_key) in enumerate(zip(states, questions_by_state, keys)):
                if decision == 'execution-mode@1' and state.get('existing_mode') in ('quick', 'sdd'):
                    rows[i] = {'status': 'ok', 'recommendation': {'mode': state['existing_mode']}, 'basis': 'existing_state'}
                    continue
                if decision == 'delegation@1' and (state['current_role'] not in ('main', 'architect') or not state['available_roles']):
                    rows[i] = {'status': 'ok', 'recommendation': {'executor': state['current_role']}, 'basis': 'role_rule'}
                    continue
                cached = self.cache.get(cache_key) if revision else None
                if cached and self.clock() - cached[0] < 60:
                    self.cache.move_to_end(cache_key)
                    rows[i] = self._row(t, state, cached[1], 'cache')
                    cache_hits += 1
                    continue
                if cache_key not in locations:
                    locations[cache_key] = []
                    request_keys.append(cache_key)
                    request_questions.append(questions)
                    requests.append({'state': state, 'questions': questions, 'model': model})
                locations[cache_key].append(i)
            try:
                if requests:
                    if self.failure and self.failure[0] == scope:
                        raise ServiceError('circuit_open')
                    backend = 'server_batch' if provider == 'laya' else 'jev_systemone'
                    network_calls = 1 if provider == 'laya' else len(requests)
                    results = self._predict_requests(requests, provider)
                    for cache_key, questions, result in zip(request_keys, request_questions, results):
                        try:
                            answers = validate_answers(result, questions)
                            for i in locations[cache_key]:
                                rows[i] = self._row(t, states[i], answers, 'model')
                            if revision and all(rows[i]['status'] == 'ok' for i in locations[cache_key]):
                                self.cache[cache_key] = (self.clock(), answers)
                                self.cache.move_to_end(cache_key)
                                while len(self.cache) > 256:
                                    self.cache.popitem(last=False)
                        except (TypeError, ValueError):
                            for i in locations[cache_key]:
                                rows[i] = fallback('invalid_response')
            except (ServiceError, ValueError) as error:
                reason = str(error) if isinstance(error, ServiceError) else 'invalid_request'
                # A service outage fails once per MCP process; no sequential or legacy retry.
                if reason != 'circuit_open':
                    self.failure = (scope, reason)
                for i, row in enumerate(rows):
                    if row is None:
                        rows[i] = fallback(reason)
        for item_id, row in zip(ids, rows):
            row['id'] = item_id
        failures = sum(r['status'] == 'fallback' for r in rows)
        event = {'schema': 1, 'time': int(time.time()), 'template_hash': t['digest'],
                 'count': len(rows), 'cache_hits': cache_hits, 'network_calls': network_calls,
                 'fallbacks': failures, 'elapsed_ms': round((self.clock()-started)*1000, 2), 'backend': backend}
        written = metric(event)
        return {'status': 'ok' if not failures else ('fallback' if failures == len(rows) else 'partial'),
                'decision': decision, 'template_hash': t['digest'], 'advisory': True,
                'results': rows, 'metrics': {k: event[k] for k in ('elapsed_ms', 'network_calls', 'cache_hits', 'backend')},
                'metrics_written': written}

    @staticmethod
    def _row(template, state, answers, basis):
        selected = guard(template, state, answers)
        if selected is None:
            return fallback('uncertain_or_disallowed')
        return {'status': 'ok', 'recommendation': selected, 'basis': basis}

    def predict(self, state, questions, model='auto'):
        """Development/experimentation only; ordinary repeated work uses run()."""
        if not enabled():
            return fallback('disabled')
        with self.lock:
            try:
                if not isinstance(state, dict) or len(encode(state).decode()) > 4096:
                    raise ValueError('invalid state')
                cfg = provider_config()
                provider, base, key = cfg['provider'], cfg['base'], cfg['key']
                selected = cfg['model'] if model in ('auto', '') else validate_model(provider, model)
                validate_provider_questions(provider, questions)
                scope = hashlib.sha256(encode([provider, base, key])).hexdigest()
                if self.failure and self.failure[0] == scope:
                    return fallback('circuit_open')
                result = self._predict_requests(
                    [{'state': state, 'questions': questions, 'model': selected}], provider)[0]
                return {'answers': validate_answers(result, questions), 'advisory': True}
            except ServiceError as error:
                self.failure = (scope, str(error))
                return fallback(str(error))
            except (TypeError, ValueError):
                return fallback('invalid_configuration_input_or_response')
