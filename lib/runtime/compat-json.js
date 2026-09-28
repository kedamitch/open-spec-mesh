import { isLosslessNumber, LosslessNumber } from 'lossless-json';

const FLOAT_TAG = Symbol('python-float');
const ORDERED_KEYS = Symbol('python-object-key-order');

export function pythonFloat(value) {
  const number = Number(value);
  return Object.freeze({ [FLOAT_TAG]: true, value: number });
}

function codePointCompare(left, right) {
  const a = Array.from(left, (char) => char.codePointAt(0));
  const b = Array.from(right, (char) => char.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function quoteString(value, ensureAscii) {
  let output = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const char = value[i];
    if (char === '"') output += '\\"';
    else if (char === '\\') output += '\\\\';
    else if (char === '\b') output += '\\b';
    else if (char === '\f') output += '\\f';
    else if (char === '\n') output += '\\n';
    else if (char === '\r') output += '\\r';
    else if (char === '\t') output += '\\t';
    else if (code < 0x20) output += `\\u${code.toString(16).padStart(4, '0')}`;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        const scalar = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        if (ensureAscii) {
          const adjusted = scalar - 0x10000;
          output += `\\u${(0xd800 + (adjusted >> 10)).toString(16)}\\u${(0xdc00 + (adjusted & 0x3ff)).toString(16)}`;
        } else output += char + value[i + 1];
        i += 1;
      } else output += `\\u${code.toString(16)}`;
    } else if (code >= 0xdc00 && code <= 0xdfff) output += `\\u${code.toString(16)}`;
    else if (ensureAscii && code > 0x7f) output += `\\u${code.toString(16).padStart(4, '0')}`;
    else output += char;
  }
  return `${output}"`;
}

function pythonFloatString(number) {
  if (Number.isNaN(number)) return 'NaN';
  if (number === Infinity) return 'Infinity';
  if (number === -Infinity) return '-Infinity';
  if (Object.is(number, -0)) return '-0.0';
  if (number === 0) return '0.0';
  const sign = number < 0 ? '-' : '';
  const raw = Math.abs(number).toString().toLowerCase();
  const [coefficient, exponentText] = raw.split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const dot = coefficient.indexOf('.');
  const decimalPosition = (dot === -1 ? coefficient.length : dot) + exponent;
  let digits = coefficient.replace('.', '');
  const leading = digits.match(/^0*/u)?.[0].length ?? 0;
  digits = digits.slice(leading).replace(/0+$/u, '') || '0';
  const scientificExponent = decimalPosition - leading - 1;
  if (scientificExponent < -4 || scientificExponent >= 16) {
    const mantissa = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
    const exponentSign = scientificExponent >= 0 ? '+' : '-';
    return `${sign}${mantissa}e${exponentSign}${String(Math.abs(scientificExponent)).padStart(2, '0')}`;
  }
  const point = scientificExponent + 1;
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function encodeNumber(value) {
  if (value?.[FLOAT_TAG]) return pythonFloatString(value.value);
  if (isLosslessNumber(value)) {
    const raw = value.toString();
    if (!/[.eE]/u.test(raw)) return BigInt(raw).toString();
    return pythonFloatString(Number(raw));
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'number') throw new TypeError('Expected a JSON number');
  if (!Number.isFinite(value)) return pythonFloatString(value);
  return Number.isInteger(value) && !Object.is(value, -0) ? String(value) : pythonFloatString(value);
}

function encode(value, options, level, ancestors) {
  const { ensureAscii, separators, indent, sortKeys } = options;
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') return quoteString(value, ensureAscii);
  if (typeof value === 'number' || typeof value === 'bigint' || isLosslessNumber(value) || value?.[FLOAT_TAG]) return encodeNumber(value);
  if (typeof value !== 'object') throw new TypeError(`Object of type ${typeof value} is not JSON serializable`);
  if (ancestors.has(value)) throw new TypeError('Circular reference detected');
  ancestors.add(value);
  try {
    const childIndent = typeof indent === 'number' ? ' '.repeat(indent) : indent;
    const pretty = indent !== null && indent !== undefined;
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const entries = value.map((item) => encode(item, options, level + 1, ancestors));
      if (!pretty) return `[${entries.join(separators.item)}]`;
      return `[\n${entries.map((entry) => `${childIndent.repeat(level + 1)}${entry}`).join(',\n')}\n${childIndent.repeat(level)}]`;
    }
    const enumerableKeys = Object.keys(value);
    const recordedOrder = value[ORDERED_KEYS];
    const keys = recordedOrder
      ? [...recordedOrder.filter((key) => Object.hasOwn(value, key)), ...enumerableKeys.filter((key) => !recordedOrder.includes(key))]
      : enumerableKeys;
    if (sortKeys) keys.sort(codePointCompare);
    if (keys.length === 0) return '{}';
    const colon = separators.key;
    const entries = keys.map((key) => `${quoteString(key, ensureAscii)}${colon}${encode(value[key], options, level + 1, ancestors)}`);
    if (!pretty) return `{${entries.join(separators.item)}}`;
    return `{\n${entries.map((entry) => `${childIndent.repeat(level + 1)}${entry}`).join(',\n')}\n${childIndent.repeat(level)}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function legacyJson(value, options = {}) {
  const indent = options.indent ?? null;
  const separatorsInput = options.separators ?? (indent === null ? [', ', ': '] : [',', ': ']);
  if (!Array.isArray(separatorsInput) || separatorsInput.length !== 2) throw new TypeError('separators must contain item and key separators');
  const normalized = {
    ensureAscii: options.ensureAscii ?? true,
    separators: { item: separatorsInput[0], key: separatorsInput[1] },
    indent: typeof indent === 'number' ? Math.max(0, Math.trunc(indent)) : indent,
    sortKeys: options.sortKeys ?? false,
  };
  return encode(value, normalized, 0, new Set());
}

function parseSafeJson(text, rejectDuplicateKeys) {
  let cursor = 0;
  const fail = (message) => { throw new SyntaxError(`${message} at position ${cursor}`); };
  const whitespace = () => { while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[cursor])) cursor += 1; };
  const parseString = () => {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        try { return JSON.parse(text.slice(start, cursor)); }
        catch { fail('Invalid JSON string'); }
      }
      if (code < 0x20) fail('Control character in JSON string');
      if (code === 0x5c) {
        cursor += 1;
        const escape = text[cursor];
        if (escape === 'u') {
          const hex = text.slice(cursor + 1, cursor + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) fail('Invalid Unicode escape');
          cursor += 5;
          continue;
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail('Invalid string escape');
      }
      cursor += 1;
    }
    fail('Unterminated JSON string');
  };
  const parseValue = () => {
    whitespace();
    const char = text[cursor];
    if (char === '"') return parseString();
    if (char === '{') {
      cursor += 1;
      whitespace();
      const result = Object.create(null);
      const order = [];
      Object.defineProperty(result, ORDERED_KEYS, { value: order, enumerable: false });
      const keys = new Set();
      if (text[cursor] === '}') { cursor += 1; return result; }
      while (cursor < text.length) {
        whitespace();
        if (text[cursor] !== '"') fail('Object key must be a string');
        const key = parseString();
        whitespace();
        if (text[cursor] !== ':') fail('Object value expected after ":"');
        cursor += 1;
        const value = parseValue();
        if (keys.has(key) && rejectDuplicateKeys) fail(`Duplicate JSON field: ${key}`);
        if (!keys.has(key)) order.push(key);
        keys.add(key);
        Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
        whitespace();
        if (text[cursor] === '}') { cursor += 1; return result; }
        if (text[cursor] !== ',') fail('Expected "," or "}"');
        cursor += 1;
      }
      fail('Unterminated JSON object');
    }
    if (char === '[') {
      cursor += 1;
      whitespace();
      const result = [];
      if (text[cursor] === ']') { cursor += 1; return result; }
      while (cursor < text.length) {
        result.push(parseValue());
        whitespace();
        if (text[cursor] === ']') { cursor += 1; return result; }
        if (text[cursor] !== ',') fail('Expected "," or "]"');
        cursor += 1;
      }
      fail('Unterminated JSON array');
    }
    if (text.startsWith('true', cursor)) { cursor += 4; return true; }
    if (text.startsWith('false', cursor)) { cursor += 5; return false; }
    if (text.startsWith('null', cursor)) { cursor += 4; return null; }
    const match = text.slice(cursor).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    if (match) { cursor += match[0].length; return new LosslessNumber(match[0]); }
    fail('Expected a JSON value');
  };
  const result = parseValue();
  whitespace();
  if (cursor !== text.length) fail('Unexpected trailing data');
  return result;
}
export function parseLosslessJson(text, { rejectDuplicateKeys = false } = {}) {
  if (typeof text !== 'string') throw new TypeError('JSON input must be text');
  return parseSafeJson(text, rejectDuplicateKeys);
}
