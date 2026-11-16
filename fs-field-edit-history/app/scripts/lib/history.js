// Freshsales "Field edit history": the tracked fields of a module and each record's change log.
// Same endpoints the record page's "Field edit history" tab uses:
//   GET  <settings>/<module>/forms                      fields, with field_options.audit_enabled
//   POST <web>/<module>/<id>/field_history?date_filter=YYYY-MM-DD,YYYY-MM-DD&page=&per_page=&sort_by=
//        body { filter: [field names], updated_by: [] }  -> { data: [...], meta: { has_next } }
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  // Freshsales keeps field edit history for these modules only.
  const SUPPORTED = { contact: 'Contacts', sales_account: 'Accounts', deal: 'Deals' };
  const PER_PAGE = 50; // the server caps pages at 50 rows
  const EARLIEST = '2000-01-01';

  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const DAY = 24 * 60 * 60 * 1000;

  /**
   * Server-side date_filter for [fromMs, toMs] (either may be null = open). It works in whole days
   * in the account's time zone, so pad a day each side; exact bounds are applied by inRange().
   */
  function dateFilter(fromMs, toMs, now = Date.now()) {
    const from = [null, undefined].includes(fromMs) ? EARLIEST : isoDay(fromMs - DAY);
    const to = isoDay(([null, undefined].includes(toMs) ? now : toMs) + DAY);
    return `${from},${to}`;
  }

  function inRange(updatedAt, fromMs, toMs) {
    const t = Date.parse(updatedAt);
    if (Number.isNaN(t)) return true; // never drop a change we can't date
    return ([null, undefined].includes(fromMs) || t >= fromMs) && ([null, undefined].includes(toMs) || t <= toMs);
  }

  /** All fields from a module's forms response, nested sections flattened. */
  function flattenFormFields(data) {
    const out = [];
    const walk = (fields) =>
      (fields || []).forEach((f) => {
        out.push(f);
        if (Array.isArray(f.fields)) walk(f.fields);
      });
    ((data && data.forms) || []).forEach((form) => walk(form.fields));
    return out;
  }

  /** [{ name, label }] for fields with change tracking on, in form order, de-duplicated. */
  function trackedFieldsFrom(data) {
    const seen = new Set();
    const out = [];
    for (const f of flattenFormFields(data)) {
      if (!f.field_options || !f.field_options.audit_enabled || f.type === 'section' || seen.has(f.name)) continue;
      seen.add(f.name);
      out.push({ name: f.name, label: String(f.label || f.name).trim() });
    }
    return out;
  }

  async function fetchTrackedFields(client, mod) {
    const { data } = await client.getFirst(client.settingsPaths(`${mod.endpoint}/forms`), undefined, {
      accept: (d) => d && Array.isArray(d.forms),
    });
    return trackedFieldsFrom(data);
  }

  function historyPaths(client, mod, id) {
    const crm = `/crm/sales/${mod.endpoint}/${id}/field_history`;
    const classic = `/${mod.endpoint}/${id}/field_history`;
    return client.style.platform === 'classic' ? [classic, crm] : [crm, classic];
  }

  /**
   * Every change on one record for `fields` within [fromMs, toMs], newest first.
   * Pages until the server says there's no next page; any failure throws (nothing is skipped).
   */
  async function fetchRecordHistory(client, mod, id, { fields, fromMs = null, toMs = null, signal } = {}) {
    const body = { filter: fields, updated_by: [] };
    let paths = historyPaths(client, mod, id);
    const rows = [];
    for (let page = 1; ; page++) {
      if (signal && signal.aborted) throw new Error('Export cancelled');
      const params = { date_filter: dateFilter(fromMs, toMs), page, per_page: PER_PAGE, sort_by: 'desc' };
      let data;
      for (let i = 0; i < paths.length; i++) {
        try {
          data = await client.post(paths[i], params, body);
          paths = [paths[i]]; // remember the prefix that works
          break;
        } catch (err) {
          if (err.status !== 404 || i === paths.length - 1) throw err;
        }
      }
      // Accounts without the feature answer 200 with a bare `null`; say so rather than export nothing.
      if (!data || !Array.isArray(data.data)) throw new Error('field_history_unavailable');
      const items = data.data;
      rows.push(...items.filter((c) => inRange(c.updated_at, fromMs, toMs)));
      if (!(data && data.meta && data.meta.has_next) || !items.length) break;
    }
    return rows;
  }

  function sourceLabel(source) {
    if (!source || typeof source !== 'object') return '';
    return [source.type, source.name].filter(Boolean).join(': ');
  }

  const COLUMNS = ['Record ID', 'Record name', 'Field', 'Field key', 'Old value', 'New value', 'Changed by', 'Source', 'Changed at'];

  /** CSV rows for one record's changes. */
  function toRows(record, changes, labels) {
    return changes.map((c) => ({
      'Record ID': record.id,
      'Record name': record.name,
      Field: labels[c.field_name] || c.field_name,
      'Field key': c.field_name,
      'Old value': c.previous_value,
      'New value': c.new_value,
      'Changed by': c.modified_by,
      Source: sourceLabel(c.source),
      'Changed at': c.updated_at,
    }));
  }

  function recordName(r) {
    if (!r) return '';
    if (r.display_name) return r.display_name;
    if (r.name) return r.name;
    const full = [r.first_name, r.last_name].filter(Boolean).join(' ');
    return full || r.email || '';
  }

  FSX.history = {
    SUPPORTED,
    COLUMNS,
    dateFilter,
    inRange,
    trackedFieldsFrom,
    fetchTrackedFields,
    fetchRecordHistory,
    toRows,
    recordName,
  };
})(globalThis);
