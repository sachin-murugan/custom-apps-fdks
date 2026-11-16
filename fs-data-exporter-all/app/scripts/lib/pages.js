// Page-aware exports: works out what the open Freshsales page is (a marketing list, a segment,
// a report, a sequence, a campaign, ...) and which CSV exports make sense there. Endpoints are
// the ones the Freshsales web app itself calls, checked live on classic and Freshworks CRM
// accounts (2026-09-27). Marketing segments, campaigns and journeys live in the separate
// marketer app (/crm/marketer/mas); Suite analytics is its own app on *.freshreports.com.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const { parseListViewUrl } = FSX.platform;

  const PER_PAGE = 100;
  const MAX_PAGES = 2000;
  const MAS = '/crm/marketer/mas/api/v1';
  const SOCIAL = '/crm/marketer/social/api/v1';
  const ANALYTICS = '/api/v1/reportgroups';

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const uniq = (items) => [...new Set(items)];

  // `paths(client, id)` are tried in order; `keys` name the array in the response.
  const ACTIONS = {
    view_records: { label: 'Records in this view', view: true },
    list_contacts: { label: 'Contacts in this list', view: true },
    lists: { label: 'All marketing lists', paths: (c) => c.apiPaths('lists'), keys: ['lists'] },
    segment_contacts: {
      label: 'Contacts in this segment',
      paths: () => [`${MAS}/contacts`],
      keys: ['contacts'],
      params: (id) => ({ segment_id: id }),
      sizeParam: 'size',
    },
    segments: {
      label: 'All segments',
      paths: () => [`${MAS}/segments`],
      keys: ['segments'],
      params: () => ({ is_archived: false }),
      sizeParam: 'size',
    },
    report_table: { label: "This report's table", dom: true },
    reports: {
      label: 'All reports (list)',
      paths: (c) => c.apiPaths('custom_reports'),
      keys: ['custom_reports'],
      params: () => ({ category: 'all', created_by: 'any', include: 'user,updater,schedule' }),
    },
    sequence_contacts: {
      label: 'Contacts in this sequence',
      paths: (c, id) => c.apiPaths(`sales_sequences/${id}/drill_down`),
      keys: ['contacts', 'leads', 'deals'],
      params: () => ({ filter: 'all' }),
    },
    sales_sequences: { label: 'All sales sequences', paths: (c) => c.apiPaths('sales_sequences'), keys: ['sales_sequences'] },
    workflows: { label: 'All workflows', paths: (c) => c.apiPaths('workflow_automations'), keys: ['workflow_automations'] },
    users: {
      label: 'All users',
      paths: (c) => uniq([...c.settingsPaths('users'), ...c.selectorPaths('owners')]),
      keys: ['users', 'owners'],
    },
    email_campaigns: mas('All email campaigns', 'campaigns/general', 'campaigns', { is_archived: false }),
    transactional_campaigns: mas('All transactional emails', 'campaigns/transaction', 'campaigns', { is_archived: false }),
    social_campaigns: { label: 'All social media campaigns', paths: () => [`${SOCIAL}/campaigns`], keys: ['campaigns'], sizeParam: 'size' },
    campaign_stats: {
      label: "This campaign's stats",
      paths: (c, id) => [`${MAS}/dashboard/campaign-stats/${id}`],
      keys: ['data'],
      single: true,
    },
    journeys: mas('All journeys', 'journeys', 'journey', { is_archived: false }),
    journey_steps: { label: "This journey's steps and counts", custom: journeySteps },
    email_conversations: {
      label: 'Emails in this folder',
      paths: (c) => c.apiPaths('conversations'),
      keys: ['email_conversations'],
      params: (folder) => ({ segment_id: folder, include: 'email_conversation_recipients,targetable,user,attachments' }),
      transform: withRecipients,
    },
    tasks: { label: 'All tasks', paths: (c) => c.apiPaths('tasks'), keys: ['tasks'], variants: [{ filter: 'open' }, { filter: 'completed' }] },
    meetings: { label: 'All meetings', paths: (c) => c.apiPaths('appointments'), keys: ['appointments'] },
    sales_activities: { label: 'All sales activities', paths: (c) => c.apiPaths('sales_activities'), keys: ['sales_activities'] },
    analytics_reports: {
      label: 'All analytics reports (list)',
      paths: () => [`${ANALYTICS}/`],
      keys: ['response'],
      params: () => ({ type: 'all', sortType: 'lastModifiedDate', sortOrder: 'DESC' }),
      paging: 'offset',
      analytics: true,
    },
    analytics_report_data: { label: "This report's data (every chart)", custom: analyticsReportData, analytics: true },
  };

  function mas(label, path, key, params) {
    return { label, paths: () => [`${MAS}/${path}`], keys: [key], params: () => params, sizeParam: 'size' };
  }

  // Most specific first. Matched against pathname + hash route (the marketer app is hash-routed).
  const PAGES = [
    { re: /^(?:\/crm\/sales)?\/contacts\/list\/(\d+)/, title: 'Marketing list', actions: ['list_contacts', 'lists'] },
    { re: /^\/crm\/marketer\/mas\/#\/segments\/(\d+)/, title: 'Segment', actions: ['segment_contacts', 'segments'] },
    { re: /^\/crm\/marketer\/mas\/#\/contacts-module\/segments/, title: 'Segments', actions: ['segments'] },
    { re: /^(?:\/crm\/sales)?\/custom-reports\/[\w-]+\/(\d+)/, title: 'Report', actions: ['report_table', 'reports'] },
    { re: /^(?:\/crm\/sales)?\/custom-reports/, title: 'Reports', actions: ['reports'] },
    { re: /^(?:\/crm\/sales)?\/sales-sequences\/[a-z_]+\/(\d+)/, title: 'Sales sequence', actions: ['sequence_contacts', 'sales_sequences'] },
    { re: /^(?:\/crm\/sales)?\/sales-sequences/, title: 'Sales sequences', actions: ['sales_sequences'] },
    { re: /^(?:\/crm\/sales)?\/workflow-automations/, title: 'Workflows', actions: ['workflows'] },
    { re: /^(?:\/crm\/sales)?\/settings\/users/, title: 'Users', actions: ['users'] },
    { re: /^\/crm\/marketer\/mas\/#\/campaigns\/(?:general|transaction)\/(\d+)/, title: 'Campaign', actions: ['campaign_stats', 'email_campaigns'] },
    { re: /^\/crm\/marketer\/mas\/#\/marketing-campaigns\/campaigns\/transaction/, title: 'Transactional emails', actions: ['transactional_campaigns'] },
    { re: /^\/crm\/marketer\/mas\/#\/marketing-campaigns\/social-media-campaigns/, title: 'Social media campaigns', actions: ['social_campaigns'] },
    { re: /^\/crm\/marketer\/mas\/#\/marketing-campaigns/, title: 'Email campaigns', actions: ['email_campaigns', 'transactional_campaigns'] },
    { re: /^\/crm\/marketer\/mas\/#\/workflow\/(\d+)/, title: 'Journey', actions: ['journey_steps', 'journeys'] },
    { re: /^\/crm\/marketer\/mas\/#\/workflow/, title: 'Journeys', actions: ['journeys'] },
    { re: /^(?:\/crm\/sales)?\/conversations\/([a-z_]+)/, title: 'Email conversations', actions: ['email_conversations'] },
    // Tasks and meetings have no list page of their own on Suite; they sit with the dashboards.
    { re: /^(?:\/crm\/sales)?\/my_dashboards/, title: 'Dashboards', actions: ['tasks', 'meetings', 'sales_activities'] },
    { host: /\.freshreports\.com$/, re: /^\/#\/reports\/(\d+)/, title: 'Analytics report', actions: ['analytics_report_data', 'analytics_reports'] },
    { host: /\.freshreports\.com$/, re: /^\//, title: 'Analytics', actions: ['analytics_reports'] },
  ];

  /** { host, title, id, view?, actions: [{ key, label }] } for the page at `href`, or null. */
  function detectPage(href) {
    let url;
    try {
      url = new URL(href);
    } catch (_e) {
      return null;
    }
    const view = parseListViewUrl(href);
    if (view) return { host: url.host, title: 'List view', id: view.viewId, view, actions: [action('view_records')] };

    const route = url.pathname + url.hash.split('?')[0];
    const analytics = /\.freshreports\.com$/.test(url.host);
    for (const page of PAGES) {
      if (Boolean(page.host) !== analytics) continue;
      const m = route.match(page.re);
      if (!m) continue;
      const id = m[1] || null;
      const out = { host: url.host, title: page.title, id, actions: page.actions.map(action) };
      if (page.actions.includes('list_contacts')) {
        out.view = { host: url.host, entity: 'contact', endpoint: 'contacts', custom: false, listId: id };
      }
      return out;
    }
    return null;
  }

  function action(key) {
    return { key, label: ACTIONS[key].label };
  }

  function pickArray(data, keys, single = false) {
    if (!isObj(data)) return null;
    for (const k of keys) if (Array.isArray(data[k])) return data[k];
    if (single) for (const k of keys) if (isObj(data[k])) return [data[k]];
    return null;
  }

  /**
   * GET every page from the first path that answers with one of `keys`. Stops on total_pages,
   * else on meta.total reached or a page with nothing new. Page size isn't trusted: sales
   * sequences return 25 whatever per_page says, and workflows ignore `page` entirely.
   * `startPage` / `initial` resume an earlier run; `onPageRecords(page, items)` checkpoints it.
   */
  async function fetchAll(
    client,
    paths,
    keys,
    {
      params = {},
      sizeParam = 'per_page',
      paging = 'page',
      single = false,
      transform = (_data, items) => items,
      startPage = 1,
      initial = [],
      signal,
      onPage = () => {},
      onPageRecords = async () => {},
    } = {}
  ) {
    const out = [...initial];
    const seen = new Set(out.filter((i) => isObj(i) && i.id != null).map((i) => String(i.id)));
    let path = null;
    for (let page = startPage; page <= MAX_PAGES; page++) {
      if (signal && signal.aborted) throw new Error('Export cancelled');
      const query =
        paging === 'offset' ? { ...params, limit: PER_PAGE, offset: (page - 1) * PER_PAGE } : { ...params, page, [sizeParam]: PER_PAGE };
      const res = await client.getFirst(path ? [path] : paths, query, { accept: (d) => pickArray(d, keys, single) !== null });
      path = res.path;
      const items = transform(res.data, pickArray(res.data, keys, single));
      const fresh = items.filter((i) => !(isObj(i) && i.id != null && seen.has(String(i.id))));
      fresh.forEach((i) => isObj(i) && i.id != null && seen.add(String(i.id)));
      out.push(...fresh);
      await onPageRecords(page, fresh);
      const meta = (res.data && res.data.meta) || {};
      const totalPages = Number(meta.total_pages) || 0;
      const total = Number(meta.total != null ? meta.total : meta.total_items) || 0;
      onPage({ page, fetched: out.length, totalPages });
      // When total_pages is known it decides alone: sequence drill-downs have empty pages mid-way
      // (page 4 of 46 was empty live), so an empty page is not the end.
      if (single || (totalPages ? page >= totalPages : !fresh.length || (total && out.length >= total))) break;
    }
    return out;
  }

  /** Run a non-view action's API export. `variants` are param sets fetched one after another. */
  async function fetchAction(client, key, id, opts = {}) {
    const def = ACTIONS[key];
    if (def.custom) return def.custom(client, id, opts);
    const base = def.params ? def.params(id) : {};
    const common = { sizeParam: def.sizeParam, paging: def.paging, single: def.single, transform: def.transform };
    if (!def.variants) return fetchAll(client, def.paths(client, id), def.keys, { ...opts, ...common, params: base });
    // ponytail: variant exports (tasks) aren't checkpointed; they're small and quick to redo.
    const out = [];
    const seen = new Set();
    for (const v of def.variants) {
      const rows = await fetchAll(client, def.paths(client, id), def.keys, {
        signal: opts.signal,
        onPage: opts.onPage,
        ...common,
        params: { ...base, ...v },
      });
      for (const r of rows) if (!seen.has(String(r.id))) seen.add(String(r.id)) && out.push(r);
    }
    return out;
  }

  /** Email conversations with their from / to / cc / bcc addresses and open / click flags joined in. */
  function withRecipients(data, emails) {
    const byId = new Map(((data && data.email_conversation_recipients) || []).map((r) => [r.id, r]));
    return (emails || []).map((e) => {
      const { html_content, current_html_content, shrink_content, email_conversation_recipient_ids = [], ...rest } = e;
      const recips = email_conversation_recipient_ids.map((rid) => byId.get(rid)).filter(Boolean);
      const out = { ...rest };
      for (const field of ['from', 'to', 'cc', 'bcc', 'reply_to']) {
        const list = recips.filter((r) => r.field === field);
        if (list.length) out[field] = list.map((r) => (r.email_name ? `${r.email_name} <${r.email_address}>` : r.email_address)).join('; ');
      }
      const to = recips.filter((r) => r.field !== 'from');
      out.opened = to.some((r) => r.opened);
      out.clicked = to.some((r) => r.clicked);
      out.bounced = to.some((r) => r.bounced);
      return out;
    });
  }

  /** One row per journey step: its name from the canvas, and the live entered / exited counts. */
  async function journeySteps(client, id) {
    const j = await client.get(`${MAS}/journeys/${id}`);
    const m = await client.get(`${MAS}/journey-metrics/${id}/live-view-metrics`);
    const cells = new Map((((j.journey || {}).journeyConfig || {}).cells || []).map((c) => [c.id, c]));
    const text = (c, k) => (c && c.attrs && c.attrs[k] && c.attrs[k].text) || '';
    const stepClass = (c) => (c && c.configuration && c.configuration.executionParams && c.configuration.executionParams.executableClass) || '';
    return ((m['journey-metric'] || {}).stateLevelMetrics || []).map((s) => {
      const c = cells.get(s.id);
      return {
        id: s.id,
        journey: (j.journey || {}).name,
        step_type: c ? [c.type, c.subType].filter(Boolean).join(' / ') : '',
        // e.g. executableClass "add_contact_to_list_trigger" -> "add contact to list trigger"
        step: (c && c.name) || text(c, '.paper .body-text') || stepClass(c).replace(/_/g, ' '),
        step_detail: text(c, '.paper .body-subtext'),
        entered: s.entered,
        engaged: s.engaged,
        exited: s.exited,
        dropped: s.dropped,
        paused: s.paused,
      };
    });
  }

  // Analytics cells carry several numbers; unFormattedValue is the raw one. nonTruncatedValue
  // can be "0" when the real value is set (funnels, live), so it's only the last resort.
  const cellValue = (cell) =>
    cell && typeof cell === 'object'
      ? [cell.unFormattedValue, cell.value, cell.nonTruncatedValue].find((v) => v != null && v !== '')
      : cell;

  /**
   * Every widget in a Suite analytics report as rows. Charts (GRAPH_DATA, or x/y on funnels)
   * become long rows (chart, series, x, value); tables keep their own columns; single-number
   * widgets give one row. Widgets with no data get one row saying so.
   */
  async function analyticsReportData(client, id, { signal } = {}) {
    const group = (await client.get(`${ANALYTICS}/${id}`)).response || {};
    const rows = [];
    for (const r of group.reports || []) {
      if (signal && signal.aborted) throw new Error('Export cancelled');
      const w = (await client.get(`${ANALYTICS}/${id}/reports/${r.id}`, { limit: 1000, offset: 0 })).response || {};
      const d = w.data || {};
      const base = { report: group.name, chart: w.title || r.title, chart_type: w.chartType || r.chartType };
      const n = rows.length;
      const push = (extra) => rows.push({ id: `${r.id}-${rows.length - n}`, ...base, ...extra });

      const series = d.GRAPH_DATA || (Array.isArray(d.x) ? [{ name: (w.yLabels || [])[0] || base.chart, x: d.x, y: d.y }] : []);
      for (const sr of series) {
        (sr.x || []).forEach((x, i) => {
          const cells = Array.isArray(sr.y && sr.y[i]) ? sr.y[i] : [sr.y && sr.y[i]];
          const xs = Array.isArray(x) ? x.join(' / ') : x;
          cells.forEach((cell) => push({ series: sr.name, x: xs, value: cellValue(cell) }));
        });
      }
      if (Array.isArray(d.sheetHeaders) && Array.isArray(d.sheetValues)) {
        const names = d.sheetHeaders.map((h, i) => (h && ((h.attribute && h.attribute.label) || h.label)) || `column ${i + 1}`);
        for (const sv of d.sheetValues) {
          const row = {};
          names.forEach((name, i) => {
            const cell = sv[`sheetColumn${i}`];
            row[name] = cell && typeof cell === 'object' ? (cell.label != null ? cell.label : cellValue(cell)) : cell;
          });
          push(row);
        }
      }
      if (Array.isArray(d.text)) d.text.forEach((cell) => push({ value: cellValue(cell) }));
      if (rows.length === n) push({ note: 'No data in this widget' });
    }
    return rows;
  }

  /**
   * Read a rendered HTML table into a grid: rowspan/colspan are expanded, and a cell holding
   * several lines (e.g. "Sum of Deal value / Record Count") splits its row into one row per line.
   */
  function tableToGrid(table) {
    const grid = [];
    const pending = []; // column -> { text, rowsLeft }
    for (const tr of table.rows) {
      const row = [];
      let col = 0;
      const place = () => {
        while (pending[col] && pending[col].rowsLeft > 0) {
          row[col] = pending[col].text;
          pending[col].rowsLeft -= 1;
          col += 1;
        }
      };
      for (const cell of tr.cells) {
        place();
        const text = (cell.innerText || cell.textContent || '').trim();
        for (let k = 0; k < (cell.colSpan || 1); k++) {
          row[col] = text;
          if ((cell.rowSpan || 1) > 1) pending[col] = { text, rowsLeft: cell.rowSpan - 1 };
          col += 1;
        }
      }
      place();
      const cells = Array.from(row, (v) => (v == null ? '' : v));
      const lines = cells.map((v) => v.split(/\n+/).map((s) => s.trim()));
      const height = Math.max(...lines.map((l) => l.length));
      for (let i = 0; i < height; i++) grid.push(lines.map((l) => (l.length === 1 ? l[0] : l[i] || '')));
    }
    return grid;
  }

  FSX.pages = { ACTIONS, PAGES, detectPage, fetchAll, fetchAction, pickArray, tableToGrid };
})(globalThis);
