#!/usr/bin/env python3
"""Optional GPU-host API: one resident Router, shared single/batch execution gate.

Not installed into the Codex client's Python dependencies. Requires laya[serve,fast]
only on the already-configured GPU host. No implicit CPU fallback in fast mode.
"""
from __future__ import annotations

import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import hmac
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from laya_contracts import MAX_ITEMS, MAX_REQUEST, MODELS, validate_questions, validate_answers, encode


def create_app(router, api_key: str, models=('multilingual',), batch_size=8, check_budget=None):
    from fastapi import FastAPI, HTTPException, Request
    if not api_key or not api_key.strip():
        raise ValueError('LAYA_API_KEY is required')
    if not 1 <= batch_size <= MAX_ITEMS:
        raise ValueError('batch_size out of range')
    selected = set(models)
    if not selected or not selected <= MODELS:
        raise ValueError('invalid model allowlist')
    # Queue and executor shared by both endpoints. Do not mount a separately locked batch
    # route beside laya.serve: CUDA graph buffers are not safe for concurrent forwards.
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='laya-infer')
    pending = 0

    @asynccontextmanager
    async def lifespan(app):
        try:
            yield
        finally:
            pool.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(title='Laya single/batch API', lifespan=lifespan)

    async def read(request):
        if not hmac.compare_digest(request.headers.get('authorization', '').encode(), ('Bearer '+api_key).encode()):
            raise HTTPException(401, 'invalid or missing bearer token')
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > MAX_REQUEST:
                raise HTTPException(413, 'request too large')
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError):
            raise HTTPException(400, 'invalid JSON')
        return body

    def validated(body):
        if not isinstance(body, dict) or not isinstance(body.get('state'), dict):
            raise ValueError('state must be an object')
        validate_questions(body.get('questions'))
        model = body.get('model', 'multilingual')
        if model not in selected:
            raise ValueError('model not enabled')
        if check_budget:
            check_budget(model, body['state'], body['questions'])
        return {'model': model, 'state': body['state'], 'questions': body['questions']}

    async def infer(requests, batch):
        nonlocal pending
        if pending >= 4:
            raise HTTPException(503, 'inference queue full')
        pending += 1
        try:
            def run():
                if batch:
                    results = router.predict_batch(requests, batch_size=batch_size)
                else:
                    r = requests[0]
                    results = [router.predict(r['state'], r['questions'], model=r['model'])]
                if not isinstance(results, list) or len(results) != len(requests):
                    raise ValueError('invalid result alignment')
                for result, r in zip(results, requests):
                    validate_answers(result, r['questions'])
                return results
            future = asyncio.get_running_loop().run_in_executor(pool, run)
            def finished(_):
                nonlocal pending
                pending -= 1
            future.add_done_callback(finished)
            results = await asyncio.shield(future)
            return {'results': results} if batch else results[0]
        except Exception:
            raise HTTPException(500, 'inference failed') from None

    @app.get('/health')
    async def health():
        return {'status': 'ok', 'loaded': sorted(selected), 'batch': True}

    @app.post('/v1/systemone')
    async def single(request: Request):
        body = await read(request)
        try:
            requests = [validated(body)]
        except (TypeError, ValueError):
            raise HTTPException(422, 'invalid request or token budget exceeded') from None
        return await infer(requests, False)

    @app.post('/v1/systemone/batch')
    async def batch(request: Request):
        body = await read(request)
        try:
            entries = body.get('requests') if isinstance(body, dict) else None
            if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_ITEMS:
                raise ValueError('invalid requests')
            requests = [validated(r) for r in entries]
        except (TypeError, ValueError):
            raise HTTPException(422, 'invalid request or token budget exceeded') from None
        return await infer(requests, True)

    # Resolve a locally imported annotation for FastAPI under future annotations.
    # Registration requires Request in globals; set by the module import below.
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--models', default='multilingual')
    parser.add_argument('--stock', action='store_true')
    parser.add_argument('--batch-size', type=int, default=8)
    args = parser.parse_args()
    key = os.environ.get('LAYA_API_KEY', '').strip()
    names = args.models.split(',')
    if not key or not set(names) <= MODELS or not 1 <= args.batch_size <= MAX_ITEMS or not 1 <= args.port <= 65535:
        parser.error('check API key, models, port and batch size')
    from laya import Router
    import uvicorn
    router = Router(device=os.environ.get('LAYA_DEVICE', 'cuda'))
    router.preload(names)
    for name in names:
        agent = router.load(name)
        if not args.stock:
            if agent.device.type != 'cuda':
                raise RuntimeError('CUDA required in fast mode')
            agent.accelerate(strict=True)

    def budget(model, state, questions):
        agent = router.load(model)
        # Conservative no-silent-truncation admission check; reserve head budget and markers.
        state_len = len(agent.tok(json.dumps(state, ensure_ascii=False), add_special_tokens=False)['input_ids'])
        head = agent.cfg.get('head_max_len', 192)
        if state_len + head + 32 > agent.cfg.get('max_len', 512):
            raise ValueError('state token budget exceeded')
        for q in questions.values():
            text = q['instructions'] + ' ' + json.dumps(q.get('criteria', {}), ensure_ascii=False)
            if len(agent.tok(text, add_special_tokens=False)['input_ids']) + 32 > head:
                raise ValueError('question token budget exceeded')

    sample = {'state': {'request': 'Warmup'}, 'questions': {
        'kind': {'type': 'choice', 'instructions': 'Select.', 'criteria': {'a': 'A', 'b': 'B'}}}}
    # Warm single and two-state shapes. Other production shapes can still compile on first use.
    for name in names:
        router.predict_batch([{**sample, 'model': name}] * 2, batch_size=2)
    app = create_app(router, key, names, args.batch_size, budget)
    uvicorn.run(app, host=args.host, port=args.port, limit_concurrency=16)


# No torch/Laya import when used as an app factory or by protocol tests.
from fastapi import Request

if __name__ == '__main__':
    main()
