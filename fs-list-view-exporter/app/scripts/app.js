// FS List View Exporter as a Freshworks CRM app: pick a saved list view, page through it with
// the account's API key (through the platform's Request Method) and save a CSV.
(function () {
  const { ExportFetcher } = FSX.fetcher;
  const { flattenRecords, unionFieldnames } = FSX.flatten;
  const { toCsv, sanitizeFilename } = FSX.csv;
  const { initialSelection, applySelection, rememberSelection, prefsKey } = FSX.columns;
  const { pickColumns } = FSX.columnPicker;
  const { store, connect, makeClient } = FSX.bridge;
  const { $, renderState, downloadCsv, today, errorText } = FSX.ui;

  let running = null; // { aborted } while an export is in flight
  let picker = null;
  let conn = null;

  const log = (msg) => console.debug('[FS List View Exporter]', msg);

  // Let the user choose columns (remembered per account and module). Returns the ordered
  // column list, or null if they cancelled.
  async function chooseColumns(view, columns, recordCount) {
    if (!$('ask-columns').checked) return columns;
    const key = prefsKey(view.host, view.entity);
    let prefs = {};
    try {
      ({ columnPrefs: prefs = {} } = await store.get('columnPrefs'));
    } catch (_e) {}
    const chosen = await pickColumns({ columns, initial: initialSelection(columns, prefs[key]), recordCount, viewName: view.viewName });
    if (!chosen) return null;
    try {
      prefs[key] = rememberSelection(columns, chosen, prefs[key]);
      await store.set({ columnPrefs: prefs });
    } catch (_e) {}
    return applySelection(columns, chosen);
  }

  function progressState(p) {
    if (p.phase === 'detail') {
      return { status: 'running', message: `Loading full details: ${p.enriched} of ${p.total} records`, page: p.enriched, totalPages: p.total };
    }
    return {
      status: 'running',
      message: `Fetched ${p.fetched} records (page ${p.page}${p.totalPages ? ` of ${p.totalPages}` : ''})`,
      page: p.page,
      totalPages: p.totalPages,
    };
  }

  async function runExport() {
    const view = picker && picker.current();
    if (running || !view) return;
    running = { aborted: false };
    const signal = running;
    try {
      renderState({ status: 'running', message: 'Loading lookups…' });
      const fetcher = new ExportFetcher(makeClient(conn));
      view.viewName = view.viewName || `${view.endpoint}-view-${view.viewId}`;
      const records = await fetcher.fetchViewRecords(view, view.viewId, {
        log,
        signal,
        enrichDetails: $('enrich').checked,
        onProgress: (p) => renderState(progressState(p)),
      });
      if (!records.length) return renderState({ status: 'done', message: 'This view has no records.' });

      renderState({ status: 'running', message: `Building CSV for ${records.length} records…` });
      const rows = flattenRecords(records, fetcher.registry);
      const columns = await chooseColumns(view, unionFieldnames(rows), records.length);
      if (!columns) return renderState({ status: 'done', message: 'Export cancelled.' });
      downloadCsv(toCsv(rows, columns), `${sanitizeFilename(view.viewName)} ${today()}.csv`);
      renderState({ status: 'done', message: `Exported ${records.length} records, ${columns.length} columns.` });
    } catch (err) {
      log(errorText(err));
      renderState({ status: 'error', message: friendlyError(errorText(err)) });
    } finally {
      running = null;
    }
  }

  function friendlyError(message) {
    if (/Export cancelled/.test(message)) return 'Export cancelled.';
    if (/HTTP 429/.test(message)) return 'The export kept hitting the rate limit. Wait a minute and try again.';
    if (/HTTP 401|HTTP 403/.test(message)) {
      return 'Freshsales refused the request. Check the domain and API key in the app settings, and that this user can see the view.';
    }
    if (/All paths failed/.test(message)) return 'Could not reach the list view API for this account. Details are in the browser console.';
    return message;
  }

  async function start() {
    try {
      conn = await connect();
    } catch (err) {
      $('account').textContent = '';
      return renderState({ status: 'error', message: errorText(err) });
    }
    $('account').textContent = `Connected to ${conn.host}`;
    const fetcher = new ExportFetcher(makeClient(conn));
    picker = FSX.views.setupViewPicker({
      host: conn.host,
      fetcher,
      onChange: (selection) => ($('export').disabled = !selection || !!running),
    });
    $('export').addEventListener('click', runExport);
    $('cancel').addEventListener('click', () => {
      if (running) running.aborted = true;
    });
  }

  start();
})();
