// Same-origin HTTP client used from the content script. Ported from crm_export/client.py.
//
// Auth: by default requests ride on the user's logged-in browser session (cookies are
// sent automatically because the content script fetches from the CRM's own origin).
// If the user saved an API key in the options page, it's sent as
// `Authorization: Token token=...`, the same scheme the desktop exporter uses.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const { pathStyleFor, otherStyle, joinPrefix } = FSX.platform;

  const MAX_RETRIES = 5;
  // Rate limits get their own, longer budget: waiting out a 429 is normal on big exports.
  const MAX_RATE_LIMIT_WAITS = 10;

  class HttpError extends Error {
    constructor(status, path, body) {
      super(`HTTP ${status} GET ${path}: ${String(body || '').slice(0, 300)}`);
      this.status = status;
      this.path = path;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Retry-After header (seconds or HTTP date) in ms, or null when absent/unparseable. */
  function parseRetryAfter(value, now = Date.now()) {
    if (value === null || value === undefined || value === '') return null;
    const s = String(value).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
    const at = Date.parse(s);
    return Number.isNaN(at) ? null : Math.max(0, at - now);
  }

  function uniq(items) {
    return [...new Set(items)];
  }

  class CRMClient {
    constructor({ host, apiKey, fetchImpl, origin, sleepImpl, onRetry, extraHeaders } = {}) {
      this.host = host;
      this.origin = origin || `https://${host}`;
      this.style = pathStyleFor(host);
      this.apiKey = (apiKey || '').trim();
      this.fetch = fetchImpl || root.fetch.bind(root);
      this.retryDelay = (attempt, cap) => Math.min(2 ** attempt, cap) * 1000;
      this.sleep = sleepImpl || sleep;
      this.onRetry = onRetry || (() => {});
      this.extraHeaders = extraHeaders || {};
    }

    get platformLabel() {
      return this.style.label;
    }

    headers() {
      const h = { Accept: 'application/json', ...this.extraHeaders };
      if (this.apiKey) h.Authorization = `Token token=${this.apiKey}`;
      return h;
    }

    async get(path, params) {
      const url = new URL(path.startsWith('/') ? path : `/${path}`, this.origin);
      for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));

      let lastErr;
      let rateLimitWaits = 0;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let resp;
        try {
          resp = await this.fetch(url.toString(), {
            method: 'GET',
            credentials: 'include',
            headers: this.headers(),
          });
        } catch (err) {
          lastErr = err;
          if (attempt < MAX_RETRIES) {
            await this.wait(this.retryDelay(attempt, 15), { reason: 'network', path });
            continue;
          }
          throw new Error(`GET ${path} failed: ${err.message}`);
        }
        if (resp.status === 429) {
          lastErr = new HttpError(429, path, 'rate limited');
          if (++rateLimitWaits >= MAX_RATE_LIMIT_WAITS) break;
          const retryAfter = parseRetryAfter(resp.headers && resp.headers.get('Retry-After'));
          await this.wait(retryAfter !== null ? retryAfter : this.retryDelay(rateLimitWaits, 60), { reason: 'rate_limit', path });
          attempt -= 1; // a 429 doesn't use up the error budget
          continue;
        }
        if (resp.status >= 500 && attempt < MAX_RETRIES) {
          lastErr = new HttpError(resp.status, path, '');
          await this.wait(this.retryDelay(attempt, 20), { reason: 'server_error', path });
          continue;
        }
        if (resp.status === 304) return {};
        const text = await resp.text();
        if (!resp.ok) throw new HttpError(resp.status, path, text);
        if (!text.trim()) return {};
        try {
          return JSON.parse(text);
        } catch (_e) {
          // An HTML page usually means we hit a web route or a login redirect, not the API.
          throw new HttpError(resp.status === 200 ? 404 : resp.status, path, 'non-JSON response');
        }
      }
      throw new Error(`GET ${path} failed: ${lastErr && lastErr.message}`);
    }

    async wait(ms, info) {
      this.onRetry({ ...info, waitMs: ms });
      await this.sleep(ms);
    }

    /**
     * Try paths in order, skipping 4xx; return { data, path } for the first that works.
     * `accept(data)` can reject a 200 whose body isn't the expected shape (try the next path).
     */
    async getFirst(paths, params, { accept } = {}) {
      const errors = [];
      for (const path of paths) {
        let data;
        try {
          data = await this.get(path, params);
        } catch (err) {
          errors.push(err.message);
          if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) continue;
          throw err;
        }
        if (accept && !accept(data)) {
          errors.push(`Unexpected response from ${path}`);
          continue;
        }
        return { data, path };
      }
      throw new Error('All paths failed:\n  ' + errors.slice(0, 12).join('\n  '));
    }

    apiPaths(suffix) {
      const prefixes = uniq([...this.style.apiFallbacks, ...otherStyle(this.style).apiFallbacks]);
      return prefixes.map((p) => joinPrefix(p, suffix));
    }

    settingsPaths(suffix) {
      const prefixes = uniq([...this.style.settingsFallbacks, ...otherStyle(this.style).settingsFallbacks]);
      return prefixes.map((p) => joinPrefix(p, suffix));
    }

    selectorPaths(resource) {
      const prefixes = uniq([...this.style.selectorFallbacks, ...otherStyle(this.style).selectorFallbacks]);
      return prefixes.map((p) => joinPrefix(p, resource));
    }
  }

  FSX.client = { CRMClient, HttpError, parseRetryAfter };
})(globalThis);
