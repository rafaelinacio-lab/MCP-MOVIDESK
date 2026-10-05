import { config } from './config.js';

const { baseUrl, token, rpm, timeoutMs } = config.movidesk;

// ---- Fila simples de rate limit (janela deslizante de 60s) ----
const stamps = [];
let chain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function acquire() {
  const p = chain.then(async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= 60000) stamps.shift();
      if (stamps.length < rpm) {
        stamps.push(now);
        return;
      }
      await sleep(60000 - (now - stamps[0]) + 50);
    }
  });
  chain = p.catch(() => {});
  return p;
}

export class MovideskError extends Error {
  constructor(status, body) {
    super(`Movidesk HTTP ${status}: ${String(body).slice(0, 500)}`);
    this.status = status;
  }
}

/**
 * GET na API pública do Movidesk.
 * @param {string} path ex: '/tickets'
 * @param {Record<string, string|number|undefined>} params parâmetros OData ($filter, $select, ...) ou id
 */
export async function movideskGet(path, params = {}) {
  const url = new URL(baseUrl + path);
  url.searchParams.set('token', token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await acquire();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after')) || 15 * (attempt + 1);
      if (attempt < 2) {
        await sleep(retryAfter * 1000);
        continue;
      }
    }
    if (res.status === 404) return null;

    const text = await res.text();
    if (!res.ok) throw new MovideskError(res.status, text);
    return text ? JSON.parse(text) : null;
  }
  throw new MovideskError(429, 'Rate limit persistente');
}
