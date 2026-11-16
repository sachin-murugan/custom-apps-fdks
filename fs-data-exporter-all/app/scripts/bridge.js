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
    // The platform explains its own rejections (bad template, failed validation) in `errors`.
    const detail = Array.isArray(res.errors) && res.errors.length ? ` ${JSON.stringify(res.errors)}` : '';
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: headerGetter(res.headers) },
      text: () => Promise.resolve(text + detail),
    };
  }

  /**
   * A fetch() stand-in for CRMClient. Only the path and query of the URL are used. The request
   * template fills in the account's own host (current_host.endpoint_urls) and the Authorization
   * header. `templates` names the template for each HTTP method.
   */
  function makeFetch(fw, { templates, minGapMs = MIN_GAP_MS, sleepImpl = sleep, now = Date.now } = {}) {
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
        res = await fw.request.invokeTemplate(templates[method], options);
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

  // Request templates per product. A template can only name one product's URL, and an account
  // has either Freshworks CRM (Freshsales Suite) or classic Freshsales.
  const TEMPLATES = {
    freshworks_crm: { GET: 'crmGet', POST: 'crmPost' },
    freshsales: { GET: 'classicGet', POST: 'classicPost' },
  };

  /** Which product this account is, and its host, from the platform's currentHost data. */
  function pickProduct(endpointUrls) {
    const urls = endpointUrls || {};
    const names = Object.keys(TEMPLATES).filter((p) => urls[p]);
    if (!names.length) return null;
    // Local testing lists both products with the same URL; go by the domain then.
    const classic = names.find((p) => p === 'freshsales' && /(^|\.)freshsales\.io$/.test(normalizeHost(urls[p])));
    const product = classic || names[0];
    return { product, host: normalizeHost(urls[product]) };
  }

  /** Wait for the platform client and find the Freshsales account the app is installed on. */
  async function connect() {
    const fw = await root.app.initialized();
    const data = await fw.data.get('currentHost');
    const found = pickProduct(data && data.currentHost && data.currentHost.endpoint_urls);
    if (!found) throw new Error("This account doesn't have Freshsales, so there is nothing to export.");
    const options = { templates: TEMPLATES[found.product] };
    if (typeof FSX.minGapMs === 'number') options.minGapMs = FSX.minGapMs;
    return { fw, host: found.host, fetchImpl: makeFetch(fw, options) };
  }

  FSX.bridge = { MIN_GAP_MS, normalizeHost, toResponse, makeFetch, makeClient, pickProduct, store, connect };
})(globalThis);
