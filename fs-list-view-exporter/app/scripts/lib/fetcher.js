// Pages through a saved list view and returns raw records, optionally merging in each
// record's detail-API payload. Ported from crm_export/fetcher.py.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const { listIncludesFor, detailIncludesFor, isCpq } = FSX.platform;
  const { LookupRegistry } = FSX.lookups;
  const { deepMerge } = FSX.flatten;

  const PER_PAGE = 100;
  const DETAIL_CONCURRENCY = 4;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const hasId = (r) => isObj(r) && r.id !== null && r.id !== undefined;

  /** Run `worker` over `items` with at most `limit` in flight; results keep input order. */
  async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const run = async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
    return results;
  }

  function recordsFromPage(data, primaryKey, entity) {
    if (!data || typeof data !== 'object') return [];
    const candidates = [primaryKey, entity, entity && !entity.endsWith('s') ? `${entity}s` : entity, 'records', 'results'];
    for (const key of new Set(candidates)) {
      if (key && Array.isArray(data[key]) && data[key].length) return data[key];
    }
    if (Array.isArray(data.data) && data.data.length && typeof data.data[0] === 'object') return data.data;
    return [];
  }

  function uniq(items) {
    return [...new Set(items)];
  }

  class ExportFetcher {
    constructor(client) {
      this.client = client;
      this.registry = new LookupRegistry();
    }

    viewPaths(mod, viewId) {
      if (isCpq(mod)) {
        const e = mod.endpoint;
        return uniq([...this.client.apiPaths(`cpq/${e}`), `/crm/sales/cpq/${e}`, `/api/cpq/${e}`, `/cpq/${e}`]);
      }
      if (mod.custom) {
        return uniq([
          ...this.client.apiPaths(`custom_module/${mod.entity}/view/${viewId}`),
          `/custom_module/${mod.entity}/view/${viewId}`,
        ]);
      }
      return uniq([...this.client.apiPaths(`${mod.endpoint}/view/${viewId}`), `/${mod.endpoint}/view/${viewId}`]);
    }

    /** Saved views for a module as [{ id, name }]. */
    async fetchViews(mod) {
      let paths;
      if (isCpq(mod)) {
        const e = mod.endpoint;
        paths = [
          ...this.client.apiPaths(`cpq/filters/${e}`),
          `/crm/sales/cpq/filters/${e}`,
          `/api/cpq/filters/${e}`,
          `/cpq/filters/${e}`,
        ];
      } else if (mod.custom) {
        paths = [...this.client.apiPaths(`${mod.entity}/filters`), `/${mod.entity}/filters`, `/api/${mod.entity}/filters`];
      } else {
        paths = [...this.client.apiPaths(`${mod.endpoint}/filters`), `/${mod.endpoint}/filters`];
      }
      const { data } = await this.client.getFirst(uniq(paths), undefined, {
        accept: (d) => isObj(d) && (Array.isArray(d.filters) || Array.isArray(d.data)),
      });
      const list = Array.isArray(data.filters) ? data.filters : data.data;
      return list.map((f) => ({ id: String(f.id), name: f.name }));
    }

    async fetchViewName(mod, viewId) {
      try {
        const views = await this.fetchViews(mod);
        const match = views.find((v) => v.id === String(viewId));
        return match ? match.name : null;
      } catch {
        return null;
      }
    }

    listParams(mod, page, viewId) {
      if (isCpq(mod)) {
        return { segment_id: viewId, page, per_page: PER_PAGE, include: listIncludesFor(mod.entity, false) };
      }
      const params = {
        page,
        per_page: PER_PAGE,
        include: listIncludesFor(mod.entity, mod.custom),
        sort: 'id',
        sort_type: 'asc',
      };
      if (!mod.custom) params.load_as_per_list_page_config = 'true';
      return params;
    }

    /**
     * Fetch every record in the view. `onProgress({ page, fetched, totalPages })` is called per list
     * page, then `onProgress({ phase: 'detail', enriched, total })` per record when `enrichDetails`
     * is set. `signal` is an optional { aborted } object checked between requests.
     */
    async fetchViewRecords(
      mod,
      viewId,
      { log = () => undefined, onProgress = () => undefined, signal, enrichDetails = false, concurrency = DETAIL_CONCURRENCY } = {}
    ) {
      this.registry = new LookupRegistry();
      log(`Platform: ${this.client.platformLabel}`);
      await this.registry.loadSelectors(this.client, log, FSX.lookups.selectorsFor(mod.entity));
      await this.registry.loadFieldDefinitions(this.client, mod.entity, mod.endpoint, mod.custom);

      let paths = this.viewPaths(mod, viewId);
      const all = [];
      let page = 1;
      for (;;) {
        if (signal && signal.aborted) throw new Error('Export cancelled');
        const { data, path } = await this.client.getFirst(paths, this.listParams(mod, page, viewId));
        // Stick with the path that worked so later pages don't re-probe the fallbacks.
        paths = [path];

        const records = isCpq(mod)
          ? (Array.isArray(data && data[mod.endpoint]) ? data[mod.endpoint] : [])
          : recordsFromPage(data, mod.custom ? mod.entity : mod.endpoint, mod.entity);
        if (!records.length) break;
        all.push(...records);

        const meta = (data && data.meta) || {};
        this.registry.ingestLookupInformation(meta.lookup_information);
        records.forEach((r) => r && this.registry.ingestLookupInformation(r.lookup_information));

        const totalPages = Number(meta.total_pages) || 0;
        onProgress({ page, fetched: all.length, totalPages });
        log(`Page ${page}${totalPages ? `/${totalPages}` : ''}: +${records.length} (total ${all.length})`);

        page += 1;
        if (totalPages && page > totalPages) break;
        if (records.length < PER_PAGE) break;
      }
      if (!enrichDetails || !all.length) return all;
      return this.enrichRecords(mod, all, { log, onProgress, signal, concurrency });
    }

    /**
     * Merge each record's detail payload over its list row (list views on classic Freshsales
     * often leave association objects empty). Records without an id are dropped, as in the
     * desktop exporter; a failed detail fetch keeps the list row.
     */
    enrichRecords(mod, records, { log = () => undefined, onProgress = () => undefined, signal, concurrency = DETAIL_CONCURRENCY } = {}) {
      const withIds = records.filter(hasId);
      const total = withIds.length;
      log(`Enriching ${total} records via detail API (${concurrency} at a time)…`);
      let enriched = 0;
      return mapWithConcurrency(withIds, concurrency, async (base) => {
        if (signal && signal.aborted) throw new Error('Export cancelled');
        let merged = base;
        try {
          const detail = await this.fetchRecordDetail(mod, String(base.id));
          this.registry.ingestLookupInformation(detail.lookup_information);
          merged = deepMerge(base, detail);
        } catch (err) {
          log(`Detail fetch failed for id ${base.id}: ${err.message}`);
        }
        enriched += 1;
        onProgress({ phase: 'detail', enriched, total });
        return merged;
      });
    }

    detailPaths(mod, recordId) {
      const endpoint = mod.endpoint || mod.entity;
      if (mod.custom) {
        return uniq([
          ...this.client.apiPaths(`custom_module/${mod.entity}/${recordId}`),
          `/api/custom_module/${mod.entity}/${recordId}`,
          `/custom_module/${mod.entity}/${recordId}`,
        ]);
      }
      if (isCpq(mod)) {
        return uniq([...this.client.apiPaths(`cpq/${endpoint}/${recordId}`), ...this.client.apiPaths(`${endpoint}/${recordId}`)]);
      }
      return uniq([...this.client.apiPaths(`${endpoint}/${recordId}`), `/${endpoint}/${recordId}`]);
    }

    /** One record from the detail API, unwrapped from its `{ contact: {...} }`-style envelope. */
    async fetchRecordDetail(mod, recordId) {
      const endpoint = mod.endpoint || mod.entity;
      const keys = mod.custom ? [mod.entity, 'record', 'data'] : [mod.entity, endpoint, endpoint.replace(/s+$/, '')];
      const pick = (data) => {
        if (!isObj(data)) return null;
        for (const key of keys) if (isObj(data[key])) return data[key];
        return hasId(data) ? data : null;
      };
      const { data } = await this.client.getFirst(
        this.detailPaths(mod, recordId),
        { include: detailIncludesFor(mod.entity, mod.custom) },
        { accept: (d) => pick(d) !== null }
      );
      return pick(data);
    }
  }

  FSX.fetcher = { ExportFetcher, recordsFromPage, mapWithConcurrency };
})(globalThis);
