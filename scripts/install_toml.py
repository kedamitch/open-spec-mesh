"""Surgical TOML updates, guarded by a full semantic equality check.

The standard-library parser validates meaning. The lexer only finds whole
statements, so table-like text in multiline prompts can never become a target.
"""
from __future__ import annotations
import copy
import datetime
import json
import math
import re
import tomllib

DELETE = object()


def literal(value):
    if isinstance(value, bool): return str(value).lower()
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)): return value.isoformat()
    if isinstance(value, (int, float)): return repr(value)
    if isinstance(value, list): return '[' + ', '.join(literal(v) for v in value) + ']'
    if isinstance(value, dict): return '{' + ', '.join(key(k) + ' = ' + literal(v) for k, v in value.items()) + '}'
    raise ValueError('Unsupported TOML value type')


def key(name):
    return name if re.fullmatch(r'[A-Za-z0-9_-]+', name) else json.dumps(name, ensure_ascii=False)


def same(a, b):
    if type(a) is not type(b): return False
    if isinstance(a, dict): return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list): return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, float) and math.isnan(a) and math.isnan(b): return True
    return a == b


def statements(text):
    """Offsets of complete top-level lines/assignments (including multiline values)."""
    start = i = depth = 0
    quote = None
    comment = False
    while i < len(text):
        c = text[i]
        if comment:
            if c != '\n': i += 1; continue
            comment = False
        elif quote:
            if quote[0] == '"' and c == '\\': i += 2; continue
            if text.startswith(quote, i):
                if len(quote) == 3:
                    n = 3
                    while i + n < len(text) and text[i + n] == quote[0]: n += 1
                    i += n
                else:
                    i += 1
                quote = None
                continue
            i += 1
            continue
        elif c in ('"', "'"):
            quote = c * 3 if text.startswith(c * 3, i) else c
            i += len(quote)
            continue
        elif c == '#': comment = True
        elif c in '[{': depth += 1
        elif c in ']}': depth -= 1
        if c == '\n' and depth == 0:
            yield start, i + 1
            start = i + 1
        i += 1
    if quote or depth:
        raise ValueError('Cannot safely locate TOML statements')
    if start < len(text): yield start, len(text)


def path_of_key(raw):
    obj = tomllib.loads(raw + ' = true')
    path = []
    while isinstance(obj, dict) and len(obj) == 1:
        k, obj = next(iter(obj.items())); path.append(k)
    if obj is not True: raise ValueError('Cannot parse TOML key')
    return tuple(path)


def assignment_key(stmt):
    quote = None
    escaped = False
    for i, c in enumerate(stmt):
        if quote:
            if escaped: escaped = False
            elif quote == '"' and c == '\\': escaped = True
            elif c == quote: quote = None
        elif c in ('"', "'"): quote = c
        elif c == '=': return stmt[:i].strip()
    raise ValueError('Cannot locate TOML assignment')


def entries(text):
    table = ()
    for start, end in statements(text):
        stmt = text[start:end]; clean = stmt.strip()
        if not clean or clean.startswith('#'):
            yield start, end, 'comment', table, None
        elif clean.startswith('['):
            marker = '__sdd_parse_table_marker__'
            obj = tomllib.loads(stmt + '\n' + marker + ' = true\n')
            path = []
            while True:
                if isinstance(obj, list): obj = obj[-1]
                if marker in obj: break
                if len(obj) != 1: raise ValueError('Cannot locate TOML table')
                name, obj = next(iter(obj.items())); path.append(name)
            table = tuple(path)
            yield start, end, 'table', table, None
        else:
            raw = assignment_key(stmt)
            yield start, end, 'assignment', table + path_of_key(raw), raw


def lookup(data, path):
    for k in path: data = data[k]
    return data


def update_data(data, path, value):
    parent = data
    for k in path[:-1]:
        if k not in parent: parent[k] = {}
        if not isinstance(parent[k], dict): raise ValueError('Managed TOML path is not a table')
        parent = parent[k]
    if value is DELETE: parent.pop(path[-1], None)
    else: parent[path[-1]] = value


def set_value(text, path, value):
    """Replace a managed subtree, never silently mutate any other parsed value."""
    before = tomllib.loads(text)
    expected = copy.deepcopy(before)
    update_data(expected, path, value)
    if same(before, expected): return text
    items = list(entries(text))
    result = None
    # Inline tables / dotted assignments can own an ancestor of the target.
    for start, end, kind, where, raw in items:
        if kind == 'assignment' and path[:len(where)] == where:
            if where == path and value is DELETE:
                replacement = ''
            else:
                replacement = raw + ' = ' + literal(lookup(expected, where)) + '\n'
            result = text[:start] + replacement + text[end:]
            break
    if result is None:
        if value is DELETE or isinstance(value, dict):
            cuts = [(start, end) for start, end, _, where, _ in items if where[:len(path)] == path]
            result = text
            for start, end in reversed(cuts): result = result[:start] + result[end:]
            if value is not DELETE:
                result += ('\n' if result.endswith('\n') else '\n\n')
                result += '[' + '.'.join(key(k) for k in path) + ']\n'
                result += ''.join(key(k) + ' = ' + literal(v) + '\n' for k, v in value.items())
        else:
            parent = path[:-1]
            # Insert into an explicit parent/ancestor table, otherwise root dotted keys.
            headers = [(end, where) for _, end, kind, where, _ in items
                       if kind == 'table' and len(where) <= len(parent) and parent[:len(where)] == where]
            if headers:
                offset, prefix = max(headers, key=lambda item: len(item[1]))
            else:
                offset, prefix = 0, ()
            addition = '.'.join(key(k) for k in path[len(prefix):]) + ' = ' + literal(value) + '\n'
            if offset and not text[:offset].endswith('\n'): addition = '\n' + addition
            result = text[:offset] + addition + text[offset:]
    try:
        after = tomllib.loads(result)
    except ValueError as exc:
        raise ValueError('Cannot safely update managed TOML path ' + '.'.join(path) + '; original config is unchanged') from exc
    if value is DELETE:
        # Removing the final child of an implicit TOML table may remove its empty
        # parent as well. This is allowed only along the deleted path, nowhere else.
        for obj in (expected, after):
            for n in range(len(path)-1, 0, -1):
                try:
                    parent = lookup(obj, path[:n-1])
                    if parent.get(path[n-1]) == {}: parent.pop(path[n-1])
                except KeyError:
                    pass
    if not same(expected, after):
        raise ValueError('Unrelated TOML values would change; original config is unchanged')
    return result
