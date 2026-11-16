// Bridge between the exporter code (written for a browser extension) and the Freshworks app
// platform. A marketplace app runs in an iframe on its own origin, so it cannot use the CRM
// session cookie. Every CRM call goes through the platform's Request Method instead
// (config/requests.json), which adds the API key from the installation settings server-side.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  // The platform allows 50 Request Method calls a minute per installation. Calls are spaced
  // so a long export stays under that instead of running into 429s.
  const MIN_GAP_MS = 1300;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** "https://Acme.myfreshworks.com/crm/sales/" -> "acme.myfreshworks.com" */
  function normalizeHost(value) {
    return String(value || '')
      .trim()
      .replace(/^[a-z]+:\/\//i, '')
      .replace(/[/?#].*$/, '')
      .toLowerCase();
  }

  function headerGetter(headers) {
    const map = {};
    Object.keys(headers || {}).forEach((k) => (map[k.toLowerCase()] = headers[k]));
    return (name) => {
      const v = map[String(name).toLowerCase()];
      return v === undefined ? null : String(v);
    };
  }

  /** Shape an invokeTemplate result (or rejection) like a fetch Response. */
  function toResponse(res) {
    const status = Number(res.status);
    const body = res.response === undefined || res.response === null ? '' : res.response;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: headerGetter(res.headers) },
      text: () => Promise.resolve(text),
    };
  }

  /**
   * A fetch() stand-in for CRMClient. Only the path and query of the URL are used: the host
   * and the Authorization header come from the request template.
   */
  function makeFetch(fw, { minGapMs = MIN_GAP_MS, sleepImpl = sleep, now = Date.now } = {}) {
    let queue = Promise.resolve();
    let last = 0;
    const turn = () => {
      const mine = queue.then(async () => {
        const wait = last + minGapMs - now();
        if (wait > 0) await sleepImpl(wait);
        last = now();
      });
      queue = mine;
      return mine;
    };

    // Lookup lists and field settings don't change during a session, and several of them
    // don't exist on every plan. Remember their answers (including "not found") so a second
    // export doesn't spend the request budget on them again.
    const cache = new Map();
    const cacheable = (method, path) => method === 'GET' && /\/(selector|settings)\//.test(path);

    return async function fsxFetch(url, init) {
      const u = new URL(url);
      const path = u.pathname + u.search;
      const options = { context: { path } };
      const method = String((init && init.method) || 'GET').toUpperCase();
      if (init && init.body !== undefined) options.body = init.body;
      if (cache.has(path) && cacheable(method, path)) return toResponse(cache.get(path));
      await turn();
      let res;
      try {
        res = await fw.request.invokeTemplate(method === 'POST' ? 'crmPost' : 'crmGet', options);
      } catch (err) {
        // HTTP errors from the CRM arrive as rejections that carry a status.
        if (!err || typeof err.status !== 'number') {
          throw new Error((err && (err.message || err.response)) || 'Request failed');
        }
        res = err;
      }
      const settled = res.status < 500 && res.status !== 429 && res.status !== 401 && res.status !== 403;
      if (settled && cacheable(method, path)) cache.set(path, res);
      return toResponse(res);
    };
  }

  const KNOWN_HOST = /(^|\.)(freshsales\.io|myfreshworks\.com|freshworks\.com)$/;

  /**
   * CRMClient over the Request Method. The extension tries the other platform's paths when one
   * fails; here every miss costs a slot in the 50-a-minute budget, so on a Freshworks-hosted
   * domain only that platform's own paths are tried. Custom domains keep every fallback.
   */
  function makeClient(conn, { onRetry } = {}) {
    const client = new FSX.client.CRMClient({ host: conn.host, fetchImpl: conn.fetchImpl, onRetry });
    if (KNOWN_HOST.test(conn.host)) {
      const { joinPrefix } = FSX.platform;
      const own = (prefixes) => (suffix) => prefixes.map((p) => joinPrefix(p, suffix));
      client.apiPaths = own(client.style.apiFallbacks);
      client.settingsPaths = own(client.style.settingsFallbacks);
      client.selectorPaths = own(client.style.selectorFallbacks);
    }
    return client;
  }

  // chrome.storage.local-shaped wrapper over localStorage, for column choices and checkpoints.
  // set() throws when the browser refuses (quota, storage blocked); callers treat that as
  // "no checkpoint".
  const PREFIX = 'fsx:';
  const later = (fn) => Promise.resolve().then(fn);
  const store = {
    get: (keys) =>
      later(() => {
        const out = {};
        for (const k of [].concat(keys)) {
          const raw = root.localStorage.getItem(PREFIX + k);
          if (raw !== null) out[k] = JSON.parse(raw);
        }
        return out;
      }),
    set: (items) =>
      later(() => {
        for (const k of Object.keys(items)) root.localStorage.setItem(PREFIX + k, JSON.stringify(items[k]));
      }),
    remove: (keys) =>
      later(() => {
        for (const k of [].concat(keys)) root.localStorage.removeItem(PREFIX + k);
      }),
  };

  /** Wait for the platform client and read the account domain from the installation settings. */
  async function connect() {
    const fw = await root.app.initialized();
    const iparams = await fw.iparams.get();
    const host = normalizeHost(iparams.crmDomain);
    if (!host) throw new Error('No Freshsales domain is set. Open the app settings and enter it.');
    return { fw, host, fetchImpl: makeFetch(fw, typeof FSX.minGapMs === 'number' ? { minGapMs: FSX.minGapMs } : {}) };
  }

  FSX.bridge = { MIN_GAP_MS, normalizeHost, toResponse, makeFetch, makeClient, store, connect };
})(globalThis);
