import { MAX_REQUEST, MAX_RESPONSE, encode, parseJsonLossless, providerConfig } from './contracts.js';

export class ServiceError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ServiceError';
  }
}

export function createHttpTransport({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Node fetch is unavailable');
  return async function httpJson(method, requestPath, body) {
    const cfg = providerConfig(env);
    const payload = body === undefined ? undefined : encode(body);
    if (payload && payload.byteLength > MAX_REQUEST) throw new TypeError('request_too_large');
    const headers = { Accept: 'application/json', Authorization: `Bearer ${cfg.key}` };
    if (payload) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeout * 1000);
    try {
      let response;
      try {
        response = await fetchImpl(`${cfg.base}${requestPath}`, {
          method, headers, body: payload, redirect: 'error', signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new ServiceError('unavailable_or_timeout');
        if (error instanceof TypeError && /redirect/iu.test(error.message)) throw new ServiceError('redirect_rejected');
        throw new ServiceError('unavailable_or_timeout');
      }
      if (!response.ok) throw new ServiceError(`http_${response.status}`);
      const chunks = [];
      let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE) {
              await reader.cancel().catch(() => {});
              throw new ServiceError('response_too_large');
            }
            chunks.push(Buffer.from(value));
          }
        } finally {
          reader.releaseLock?.();
        }
      } else {
        const raw = Buffer.from(await response.arrayBuffer());
        size = raw.byteLength;
        if (size > MAX_RESPONSE) throw new ServiceError('response_too_large');
        chunks.push(raw);
      }
      const raw = Buffer.concat(chunks, size);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        return parseJsonLossless(text);
      } catch { throw new ServiceError('invalid_json'); }
    } finally {
      clearTimeout(timer);
    }
  };
}
