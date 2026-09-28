import { parse, TomlDate } from 'smol-toml';

export const DELETE = Symbol('DELETE');
const KEY = /^[A-Za-z0-9_-]+$/u;
const MARKER = '__osm_table_marker_7c62b6e2__';

export function parseToml(text) {
  if (typeof text !== 'string') throw new TypeError('TOML input must be text');
  return parse(text, { integersAsBigInt: 'asNeeded' });
}

function clone(value) {
  if (value instanceof TomlDate) return new TomlDate(value.toISOString());
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a instanceof TomlDate || b instanceof TomlDate) {
    return a instanceof TomlDate && b instanceof TomlDate
      && a.toISOString() === b.toISOString()
      && a.isLocal() === b.isLocal();
  }
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => equal(item, b[index]));
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a); const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }
  return false;
}

function keyText(value) { return KEY.test(value) ? value : JSON.stringify(value); }

function literal(value) {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return value.toString(10);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (value === Infinity) return 'inf';
    if (value === -Infinity) return '-inf';
    if (Object.is(value, -0)) return '-0.0';
    return String(value);
  }
  if (value instanceof TomlDate) return value.toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${keyText(key)} = ${literal(item)}`).join(', ')}}`;
  }
  throw new TypeError('Unsupported TOML value type');
}

export function statementRanges(text) {
  const ranges = [];
  let start = 0; let index = 0; let depth = 0; let quote = null; let comment = false;
  while (index < text.length) {
    const char = text[index];
    if (comment) {
      if (char === '\n') comment = false;
      else { index += 1; continue; }
    } else if (quote) {
      if (quote[0] === '"' && char === '\\') { index += 2; continue; }
      if (text.startsWith(quote, index)) {
        if (quote.length === 3) {
          let end = index + quote.length;
          while (text[end] === quote[0]) end += 1;
          index = end;
        } else index += 1;
        quote = null;
        continue;
      }
      index += 1;
      continue;
    } else if (char === '"' || char === "'") {
      quote = text.startsWith(char.repeat(3), index) ? char.repeat(3) : char;
      index += quote.length;
      continue;
    } else if (char === '#') comment = true;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;
    if (depth < 0) throw new Error('Cannot safely locate TOML statements');
    if (char === '\n' && depth === 0) { ranges.push([start, index + 1]); start = index + 1; }
    index += 1;
  }
  if (quote || depth !== 0) throw new Error('Cannot safely locate TOML statements');
  if (start < text.length) ranges.push([start, text.length]);
  return ranges;
}

function assignmentKey(statement) {
  let quote = null; let escaped = false;
  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (quote === '"' && char === '\\') escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '=') return statement.slice(0, index).trim();
  }
  throw new Error('Cannot locate TOML assignment');
}

function descendSinglePath(value, marker, allowArray = false) {
  const result = [];
  let cursor = value;
  for (let depth = 0; depth < 128; depth += 1) {
    if (cursor && typeof cursor === 'object' && !Array.isArray(cursor) && Object.hasOwn(cursor, marker)) return result;
    if (Array.isArray(cursor)) {
      if (!allowArray || cursor.length === 0) throw new Error('Cannot locate TOML table');
      cursor = cursor.at(-1);
      continue;
    }
    if (!cursor || typeof cursor !== 'object') throw new Error('Cannot locate TOML path');
    const keys = Object.keys(cursor);
    if (keys.length !== 1) throw new Error('Cannot locate TOML path');
    result.push(keys[0]); cursor = cursor[keys[0]];
  }
  throw new Error('TOML path nesting is too deep');
}

function pathOfKey(raw) {
  const parsed = parseToml(`${raw} = true\n`);
  const keys = Object.keys(parsed);
  const path = [];
  let cursor = parsed;
  for (let depth = 0; depth < 128; depth += 1) {
    const current = Object.keys(cursor);
    if (current.length !== 1) throw new Error('Cannot parse TOML key');
    const name = current[0]; path.push(name); cursor = cursor[name];
    if (cursor === true) return path;
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) throw new Error('Cannot parse TOML key');
  }
  throw new Error('TOML key nesting is too deep');
}

function entries(text) {
  let table = [];
  const result = [];
  for (const [start, end] of statementRanges(text)) {
    const statement = text.slice(start, end); const clean = statement.trim();
    if (!clean || clean.startsWith('#')) { result.push({ start, end, kind: 'comment', path: table, key: null }); continue; }
    if (clean.startsWith('[')) {
      const parsed = parseToml(`${statement}\n${MARKER} = true\n`);
      const path = descendSinglePath(parsed, MARKER, true);
      table = path;
      result.push({ start, end, kind: 'table', path: table, key: null });
      continue;
    }
    const raw = assignmentKey(statement);
    result.push({ start, end, kind: 'assignment', path: [...table, ...pathOfKey(raw)], key: raw });
  }
  return result;
}

function lookup(data, path) {
  let value = data;
  for (const part of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw new Error('Managed TOML path is missing');
    value = value[part];
  }
  return value;
}

function setIn(data, path, value) {
  let cursor = data;
  for (const part of path.slice(0, -1)) {
    if (!Object.hasOwn(cursor, part)) cursor[part] = {};
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part]) || cursor[part] instanceof Date) {
      throw new Error('Managed TOML path is not a table');
    }
    cursor = cursor[part];
  }
  if (value === DELETE) delete cursor[path.at(-1)];
  else cursor[path.at(-1)] = clone(value);
}

function isPrefix(prefix, value) { return prefix.length <= value.length && prefix.every((part, i) => part === value[i]); }

export function setTomlValue(text, path, value) {
  if (!Array.isArray(path) || path.length === 0 || path.some((part) => typeof part !== 'string')) throw new TypeError('Managed TOML path is invalid');
  const before = parseToml(text);
  const expected = clone(before);
  setIn(expected, path, value);
  if (equal(before, expected)) return text;
  const list = entries(text);
  let result;
  for (const item of list) {
    if (item.kind !== 'assignment' || !isPrefix(item.path, path)) continue;
    const oldStatement = text.slice(item.start, item.end);
    const eol = oldStatement.endsWith('\r\n') ? '\r\n' : '\n';
    if (item.path.length === path.length && value === DELETE) result = text.slice(0, item.start) + text.slice(item.end);
    else result = text.slice(0, item.start) + `${item.key} = ${literal(lookup(expected, item.path))}${eol}` + text.slice(item.end);
    break;
  }
  if (result === undefined) {
    if (value === DELETE || (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date))) {
      const cuts = list.filter((item) => isPrefix(path, item.path));
      result = text;
      for (const item of cuts.reverse()) result = result.slice(0, item.start) + result.slice(item.end);
      if (value !== DELETE) {
        if (result && !result.endsWith('\n')) result += '\n';
        else if (result && !result.endsWith('\n\n')) result += '\n';
        result += `[${path.map(keyText).join('.')} ]\n`.replace(' ]', ']');
        for (const [key, item] of Object.entries(value)) result += `${keyText(key)} = ${literal(item)}\n`;
      }
    } else {
      const parent = path.slice(0, -1);
      const headers = list.filter((item) => item.kind === 'table' && isPrefix(item.path, parent));
      const header = headers.sort((a, b) => b.path.length - a.path.length)[0];
      const offset = header?.end ?? 0; const prefix = header?.path ?? [];
      let addition = `${path.slice(prefix.length).map(keyText).join('.')} = ${literal(value)}\n`;
      if (offset && !text.slice(0, offset).endsWith('\n')) addition = `\n${addition}`;
      result = text.slice(0, offset) + addition + text.slice(offset);
    }
  }
  let after;
  try { after = parseToml(result); }
  catch (error) { throw new Error(`Cannot safely update managed TOML path ${path.join('.')}; original config is unchanged`, { cause: error }); }
  if (value === DELETE) {
    for (const obj of [expected, after]) {
      for (let n = path.length - 1; n > 0; n -= 1) {
        try {
          const parent = lookup(obj, path.slice(0, n - 1));
          if (parent?.[path[n - 1]] && Object.keys(parent[path[n - 1]]).length === 0) delete parent[path[n - 1]];
        } catch { /* a removed implicit parent is expected */ }
      }
    }
  }
  if (!equal(expected, after)) throw new Error('Unrelated TOML values would change; original config is unchanged');
  return result;
}

export const TOML_INTERNALS = Object.freeze({ literal, entries, pathOfKey, equal });
