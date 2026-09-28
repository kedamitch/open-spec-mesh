import { randomBytes } from 'node:crypto';
import { isLosslessNumber } from 'lossless-json';
import { legacyJson, parseLosslessJson } from '../runtime/compat-json.js';

const MAX_BUFFER = 10 * 1024 * 1024;
const TOKEN_PREFIX = '__open_spec_mesh_numeric_request_id__';

function numberText(value) {
  return value.toString();
}

function isUnsafeIntegerId(value) {
  if (!isLosslessNumber(value)) return false;
  const raw = numberText(value);
  if (!/^-?\d+$/u.test(raw)) return false;
  try {
    const integer = BigInt(raw);
    return integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER);
  } catch { return false; }
}

export class LosslessStdioTransport {
  constructor(stdin = process.stdin, stdout = process.stdout, stderr = process.stderr) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
    this.buffer = Buffer.alloc(0);
    this.started = false;
    this.onclose = undefined;
    this.onerror = undefined;
    this.onmessage = undefined;
    this.pendingIds = new Map();
    this.usedIds = new Set();
    this._onData = (chunk) => this.#consume(Buffer.from(chunk));
    this._onError = () => this.#reportProtocolError();
    this._onEnd = () => { this.close().catch(() => {}); };
  }

  async start() {
    if (this.started) throw new Error('stdio transport already started');
    this.started = true;
    this.stdin.on('data', this._onData);
    this.stdin.on('error', this._onError);
    this.stdin.on('end', this._onEnd);
    this.stdin.resume?.();
  }

  #consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_BUFFER && !this.buffer.includes(0x0a)) {
      this.onerror?.(new Error('stdio message exceeds the maximum size'));
      this.close().catch(() => {});
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf(0x0a)) !== -1) {
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (!line.length) continue;
      if (line.length > MAX_BUFFER) {
        this.onerror?.(new Error('stdio message exceeds the maximum size'));
        this.close().catch(() => {});
        return;
      }
      this.#parseLine(line);
    }
    if (this.buffer.length > MAX_BUFFER) {
      this.onerror?.(new Error('stdio message exceeds the maximum size'));
      this.close().catch(() => {});
    }
  }

  #parseLine(line) {
    let message;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(line);
      message = parseLosslessJson(text);
    } catch {
      this.#writeRaw({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }).catch(() => {});
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this.#writeRaw({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }).catch(() => {});
      return;
    }
    if (Object.hasOwn(message, 'id') && message.id !== null) {
      const rawId = message.id;
      if (isLosslessNumber(rawId)) {
        const rawKey = `number:${rawId.toString()}`;
        this.usedIds.add(rawKey);
        if (isUnsafeIntegerId(rawId)) {
          let token;
          do { token = `${TOKEN_PREFIX}${randomBytes(12).toString('hex')}`; } while (this.usedIds.has(`string:${token}`));
          const internalKey = `string:${token}`;
          this.usedIds.add(internalKey);
          this.pendingIds.set(internalKey, { rawId, rawKey });
          message.id = token;
        } else {
          const numeric = Number(rawId.toString());
          const internalKey = `number:${String(numeric)}`;
          this.pendingIds.set(internalKey, { rawId, rawKey });
          message.id = numeric;
        }
      } else if (typeof rawId === 'string') {
        const internalKey = `string:${rawId}`;
        this.usedIds.add(internalKey);
        this.pendingIds.set(internalKey, { rawId, rawKey: internalKey });
      }
    }
    this.onmessage?.(message);
  }


  async #writeRaw(message) {
    const text = `${legacyJson(message, { ensureAscii: false, separators: [',', ':'] })}\n`;
    if (!this.stdout.write(text)) await new Promise((resolve) => this.stdout.once('drain', resolve));
  }

  async send(message) {
    let outgoing = message;
    if (message && Object.hasOwn(message, 'id')) {
      const identity = typeof message.id === 'string' ? `string:${message.id}`
        : typeof message.id === 'number' ? `number:${String(message.id)}` : null;
      const pending = identity ? this.pendingIds.get(identity) : undefined;
      if (pending) {
        if (pending.rawId !== message.id) outgoing = { ...message, id: pending.rawId };
        this.pendingIds.delete(identity);
        this.usedIds.delete(identity);
        this.usedIds.delete(pending.rawKey);
      }
    }
    await this.#writeRaw(outgoing);
  }

  async close() {
    if (!this.started) return;
    this.started = false;
    this.stdin.off('data', this._onData);
    this.stdin.off('error', this._onError);
    this.stdin.off('end', this._onEnd);
    this.buffer = Buffer.alloc(0);
    this.onclose?.();
  }

  #reportProtocolError() {
    this.stderr.write('System One MCP stdio input error.\n');
  }
}
