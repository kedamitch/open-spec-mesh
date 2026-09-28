"""Python-only validation shared by the optional, separately deployed GPU API."""
from __future__ import annotations

import json
import math

MODELS = {'english', 'multilingual', 'typed-decisions'}
MAX_ITEMS = 16
MAX_REQUEST = 128 * 1024


def encode(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()


def validate_questions(questions):
    if not isinstance(questions, dict) or not 1 <= len(questions) <= 8:
        raise ValueError('questions must contain 1-8 typed judgments')
    for name, question in questions.items():
        if not isinstance(name, str) or not name or not isinstance(question, dict):
            raise ValueError('invalid question name or definition')
        if not isinstance(question.get('instructions'), str) or not question['instructions'].strip():
            raise ValueError('instructions must be a nonempty string')
        kind, criteria = question.get('type'), question.get('criteria')
        if kind == 'choice':
            if not isinstance(criteria, (dict, list)) or not 1 <= len(criteria) <= 20:
                raise ValueError('choice requires 1-20 candidates')
            if any(not isinstance(key, str) or not key.strip() for key in criteria) or len(set(criteria)) != len(criteria):
                raise ValueError('choice labels must be unique nonempty strings')
            if isinstance(criteria, dict) and any(value is not None and not isinstance(value, str) for value in criteria.values()):
                raise ValueError('choice descriptions must be strings or null')
        elif kind == 'score':
            if not isinstance(criteria, list) or not 2 <= len(criteria) <= 20 or any(not isinstance(value, str) or not value.strip() for value in criteria):
                raise ValueError('score requires 2-20 ordered descriptions')
        elif kind == 'noul':
            if criteria is not None and (not isinstance(criteria, dict) or not set(criteria) <= {'true', 'false'}
                                         or any(not isinstance(value, str) for value in criteria.values())):
                raise ValueError('noul criteria use true/false string descriptions')
        else:
            raise ValueError('unknown question type')
    if len(encode(questions)) > 16384:
        raise ValueError('question schema too large')


def validate_answers(result, questions):
    answers = result.get('answers') if isinstance(result, dict) else None
    if not isinstance(answers, dict):
        raise ValueError('missing answers')
    clean = {}
    for name, question in questions.items():
        answer, kind = answers.get(name), question['type']
        if not isinstance(answer, dict) or answer.get('type') != kind:
            raise ValueError('missing or mismatched answer')
        value = answer.get(kind)
        if kind == 'choice':
            if not isinstance(value, str) or value not in question['criteria']:
                raise ValueError('unknown answer candidate')
        else:
            maximum = len(question['criteria']) - 1 if kind == 'score' else 1
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
                raise ValueError('invalid numeric answer')
        clean[name] = {'type': kind, kind: value}
        for field in ('confidence', 'answer_confidence'):
            confidence = answer.get(field)
            if type(confidence) in (int, float) and math.isfinite(confidence) and 0 <= confidence <= 1:
                clean[name][field] = confidence
        probabilities = answer.get('probabilities')
        if kind in ('choice', 'score') and isinstance(probabilities, dict):
            labels = list(question['criteria']) if kind == 'choice' else [str(index) for index in range(len(question['criteria']))]
            if set(probabilities) == set(labels) and all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1 for value in probabilities.values()):
                if abs(sum(probabilities.values()) - 1) < .02:
                    clean[name]['probabilities'] = {key: probabilities[key] for key in labels}
    return clean
