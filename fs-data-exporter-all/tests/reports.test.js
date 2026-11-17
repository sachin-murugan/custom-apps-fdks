// "All reports (list)": which paths it asks, how it pages, and what a CSV row holds.
// The fixtures copy the shape Freshsales returned live for /custom_reports (classic, 35 reports).
for (const f of ['platform', 'client', 'lookups', 'flatten', 'pages']) await import(`../app/scripts/lib/${f}.js`);
const { CRMClient } = globalThis.FSX.client;
const { fetchAction, reportRows } = globalThis.FSX.pages;
const { flattenRecords, unionFieldnames } = globalThis.FSX.flatten;

const users = [
  { id: 11, display_name: 'Asha Owner', email: 'asha@x.test' },
  { id: 12, display_name: 'Ravi Editor', email: 'ravi@x.test' },
];
const report = (id, extra = {}) => ({
  id,
  name: `Report ${id}`,
  description: null,
  category: 'deals',
  is_public: false,
  created_at: '2024-02-29T10:10:35+00:00',
  updated_at: '2025-12-03T20:37:34+00:00',
  rules: {
    chart: true,
    chart_options: { type: 'bar', coordinates: { y: { field: 'owner.id', model: 'Deal' }, x: { id: 'avg' } } },
    filter_options: { logic: '( 1 AND 2 )', filter_rules: { default: [{ attribute: 'closed_date', operator: 'is_not_empty' }] } },
    table: true,
    table_type: 'matrix',
  },
  can_delete: true,
  shareables: [{ id: 9, shareable_type: 'User' }],
  current_user_permissions: ['edit', 'delete'],
  creator_id: 11,
  user_id: 11,
  updater_id: 12,
  schedule: null,
  ...extra,
});

/** A CRMClient whose fetch answers from `routes` (path -> [status, body]) and records each path asked. */
function clientFor(host, routes) {
  const asked = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    asked.push(u.pathname + u.search);
    const route = routes[u.pathname];
    const [status, body] = Array.isArray(route) ? route : route ? [200, route] : [404, ''];
    const text = typeof body === 'string' ? body : JSON.stringify(typeof body === 'function' ? body(u.searchParams) : body);
    return { status, ok: status < 400, headers: { get: () => null }, text: async () => text };
  };
  return { client: new CRMClient({ host, fetchImpl, sleepImpl: async () => undefined }), asked };
}

describe('reportRows', () => {
  test('keeps the readable fields, names users, and drops the rules config', () => {
    const rows = reportRows({ users }, [report(1, { schedule: { id: 5, type: 'schedule' }, is_public: true }), report(2, { rules: { table: true, table_type: 'summary' } })]);
    expect(rows[0]).toEqual({
      id: 1,
      name: 'Report 1',
      description: '',
      category: 'deals',
      visibility: 'Public',
      shows: 'chart (bar), table (matrix)',
      owned_by: 'Asha Owner',
      created_by: 'Asha Owner',
      updated_by: 'Ravi Editor',
      created_at: '2024-02-29T10:10:35+00:00',
      updated_at: '2025-12-03T20:37:34+00:00',
      scheduled: 'Yes',
    });
    expect(rows[1]).toMatchObject({ visibility: 'Private', shows: 'table (summary)', scheduled: 'No' });
  });

  test('falls back to the user id when the user is not included, and blank when there is none', () => {
    const [row] = reportRows({}, [report(3, { user_id: 99, updater_id: null })]);
    expect(row.owned_by).toBe(99);
    expect(row.updated_by).toBe('');
  });

  test('the CSV has the same 12 columns however many reports there are', () => {
    const many = Array.from({ length: 35 }, (_, i) => report(i + 1));
    const columns = unionFieldnames(flattenRecords(reportRows({ users }, many), null));
    expect(columns).toHaveLength(12);
    expect(columns.some((c) => c.startsWith('rules'))).toBe(false);
  });
});

describe('fetchAction("reports")', () => {
  test('Freshworks CRM: asks /crm/sales/custom_reports, never the /api/ paths, and pages to the end', async () => {
    const pages = { 1: [report(1), report(2)], 2: [report(3)] };
    const { client, asked } = clientFor('acme.myfreshworks.com', {
      '/crm/sales/custom_reports': (q) => ({ custom_reports: pages[q.get('page')] || [], users, meta: { total: 3, total_pages: 2 } }),
    });
    const rows = await fetchAction(client, 'reports');
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows[0].owned_by).toBe('Asha Owner');
    expect(asked.every((p) => p.startsWith('/crm/sales/custom_reports?'))).toBe(true);
    expect(asked[0]).toContain('category=all');
    expect(asked[0]).toContain('include=user%2Cupdater%2Cschedule');
  });

  test('classic freshsales.io: asks /custom_reports first', async () => {
    const { client, asked } = clientFor('acme.freshsales.io', {
      '/custom_reports': { custom_reports: [report(1)], users, meta: { total: 1, total_pages: 1 } },
    });
    const rows = await fetchAction(client, 'reports');
    expect(rows).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect(asked[0].startsWith('/custom_reports?')).toBe(true);
  });

  test('a plan without custom reports surfaces feature_not_available', async () => {
    const { client, asked } = clientFor('acme.myfreshworks.com', {
      '/crm/sales/custom_reports': [403, { errors: { code: 403, message: ['feature_not_available'] } }],
    });
    await expect(fetchAction(client, 'reports')).rejects.toThrow(/feature_not_available/);
    expect(asked.some((p) => p.includes('/api/'))).toBe(false);
  });
});
