// Headless smoke test: serves each app's app/ folder, swaps the Freshworks client script for a
// stub whose Request Method answers like a small Freshsales account, then drives the page in
// Chromium and checks the CSV each export hands to the browser.
//
//   node tools/smoke-test.js        (needs Playwright with Chromium)
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

// Runs in the page: window.app with a mock CRM behind request.invokeTemplate.
function stubClient() {
  const calls = [];
  const contacts = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, first_name: 'C', last_name: String(i + 1), email: `c${i + 1}@x.test` }));
  const json = (body) => ({ status: 200, headers: { 'Content-Type': 'application/json' }, response: JSON.stringify(body) });
  function answer(method, pathAndQuery, body) {
    const u = new URL(pathAndQuery, 'https://x.test');
    const p = u.pathname;
    const page = Number(u.searchParams.get('page') || 1);
    if (!p.startsWith('/crm/sales')) throw { status: 404, response: 'not found' };
    if (p === '/crm/sales/api/contacts/filters') return json({ filters: [{ id: 7, name: 'My Contacts' }] });
    if (p === '/crm/sales/api/contacts/view/7') {
      return json({ contacts: contacts.slice((page - 1) * 100, page * 100), meta: { total_pages: 2 } });
    }
    if (p === '/crm/sales/api/contacts/5') return json({ contact: { id: 5, display_name: 'C 5' } });
    if (p === '/crm/sales/settings/contacts/forms') {
      return json({ forms: [{ fields: [{ name: 'email', label: 'Email', field_options: { audit_enabled: true } }, { name: 'city', label: 'City', field_options: {} }] }] });
    }
    if (/^\/crm\/sales\/contacts\/\d+\/field_history$/.test(p)) {
      if (method !== 'POST' || JSON.parse(body).filter[0] !== 'email') throw { status: 400, response: 'bad body' };
      const id = p.split('/')[4];
      return json({ data: [{ field_name: 'email', previous_value: 'a', new_value: `c${id}@x.test`, modified_by: 'Sam', updated_at: '2026-01-02T03:04:05Z' }], meta: { has_next: false } });
    }
    if (p === '/crm/sales/contacts/5/timeline_feeds') {
      return json({ timeline_feeds: [{ created_at: '2026-01-02T03:04:05Z', action_type: 'note', user_id: 1 }], users: [{ id: 1, display_name: 'Sam' }], meta: { has_next: false } });
    }
    if (p === '/crm/sales/api/lists') return json({ lists: page === 1 ? [{ id: 1, name: 'Newsletter' }, { id: 2, name: 'VIP' }] : [] });
    throw { status: 404, response: 'not found' };
  }
  const fw = {
    data: {
      // window.__entity is set by the test when the app is opened on a record.
      get: async (key) => {
        if (key === 'currentHost') return { currentHost: { endpoint_urls: { freshworks_crm: 'https://acme.myfreshworks.com' } } };
        if (!window.__entity) throw new Error('no entity here');
        return { currentEntityInfo: window.__entity };
      },
    },
    request: {
      invokeTemplate: async (name, opts) => {
        calls.push({ name, path: opts.context.path, at: Date.now() });
        if (!['crmGet', 'crmPost'].includes(name)) throw { status: 404, response: `unexpected template ${name}` };
        return answer(name === 'crmPost' ? 'POST' : 'GET', opts.context.path, opts.body);
      },
    },
  };
  window.__calls = calls;
  window.__fw = fw;
  window.app = { initialized: async () => fw };
}

function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel.includes('appclient')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`(${stubClient.toString()})();`);
    }
    const file = path.join(dir, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function open(browser, app, { entity, paced } = {}) {
  const server = await serve(path.join(ROOT, app, 'app'));
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Skip the 1.3 s request spacing unless the test is about it.
  if (!paced) await page.addInitScript(() => (window.FSX = { minGapMs: 5 }));
  if (entity) await page.addInitScript((e) => (window.__entity = e), entity);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForFunction(() => document.getElementById('account').textContent.startsWith('Connected'));
  return { page, errors, close: () => (page.close(), server.close()) };
}

async function csvOf(page, click) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), click()]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  return { name: download.suggestedFilename(), lines: text.replace(/^﻿/, '').trim().split('\r\n') };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // 1. List view exporter: pick module + view, export 150 records over 2 pages.
    let t = await open(browser, 'fs-list-view-exporter', { paced: true });
    await t.page.selectOption('#module', 'contacts');
    await t.page.waitForFunction(() => [...document.getElementById('view').options].some((o) => o.value === '7'));
    await t.page.selectOption('#view', '7');
    await t.page.uncheck('#ask-columns');
    let csv = await csvOf(t.page, () => t.page.click('#export'));
    assert.match(csv.name, /^My Contacts \d{4}-\d\d-\d\d\.csv$/);
    assert.strictEqual(csv.lines.length, 151);
    assert.ok(csv.lines[0].startsWith('id,'));
    // Requests are spaced to stay under the platform's 50 a minute.
    const gaps = await t.page.evaluate(() => window.__calls.slice(1).map((c, i) => c.at - window.__calls[i].at));
    assert.ok(Math.min(...gaps) >= 1250, `requests too close together: ${Math.min(...gaps)} ms`);
    assert.deepStrictEqual(t.errors, []);
    await t.close();
    console.log('ok  fs-list-view-exporter: 150 records, 2 pages, paced');

    // 2. Data exporter: pasted list view address with the column picker, then an account export.
    t = await open(browser, 'fs-data-exporter-all');
    await t.page.fill('#url', 'https://acme.myfreshworks.com/crm/sales/contacts/view/7');
    await t.page.waitForFunction(() => !document.getElementById('export-view').disabled);
    csv = await csvOf(t.page, async () => {
      await t.page.click('#export-view');
      await t.page.locator('[data-fsx-column-picker] #ok').click({ timeout: 120000 });
    });
    assert.strictEqual(csv.lines.length, 151);
    await t.page.selectOption('#action', 'lists');
    csv = await csvOf(t.page, async () => {
      await t.page.click('#export-action');
      await t.page.locator('[data-fsx-column-picker] #ok').click({ timeout: 120000 });
    });
    assert.match(csv.name, /^All marketing lists /);
    assert.strictEqual(csv.lines.length, 3);
    assert.deepStrictEqual(t.errors, []);
    await t.close();
    console.log('ok  fs-data-exporter-all: view via pasted address, marketing lists');

    // 3. Field edit history, opened on a contact (entity menu): history and timeline.
    t = await open(browser, 'fs-field-edit-history', { entity: { currentEntityId: 5, currentEntityType: 'contact' } });
    await t.page.waitForSelector('#form:not([hidden])');
    assert.strictEqual(await t.page.textContent('#target-name'), 'C 5');
    assert.strictEqual(await t.page.isHidden('#picker'), true);
    csv = await csvOf(t.page, () => t.page.click('#export'));
    assert.deepStrictEqual(csv.lines, [
      'Record ID,Record name,Field,Field key,Old value,New value,Changed by,Source,Changed at',
      '5,C 5,Email,email,a,c5@x.test,Sam,,2026-01-02T03:04:05Z',
    ]);
    csv = await csvOf(t.page, () => t.page.click('#export-timeline'));
    assert.strictEqual(csv.lines.length, 2);
    assert.deepStrictEqual(t.errors, []);
    await t.close();

    // 3b. Full page: every record of a view (first 150 contacts).
    t = await open(browser, 'fs-field-edit-history');
    await t.page.fill('#url', 'https://acme.myfreshworks.com/crm/sales/contacts/view/7');
    await t.page.waitForSelector('#form:not([hidden])');
    csv = await csvOf(t.page, () => t.page.click('#export'));
    assert.strictEqual(csv.lines.length, 151);
    assert.deepStrictEqual(t.errors, []);
    await t.close();
    console.log('ok  fs-field-edit-history: record history, timeline, whole view');
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
