// FS List View Exporter as a Freshworks CRM app: pick a saved list view, page through it with
// the account's API key (through the platform's Request Method) and save a CSV.
(function () {
  const { ExportFetcher } = FSX.fetcher;
  const { flattenRecords, unionFieldnames } = FSX.flatten;
  const { toCsv, sanitizeFilename } = FSX.csv;
  const { initialSelection, applySelection, rememberSelection, prefsKey } = FSX.columns;
  const { pickColumns } = FSX.columnPicker;
  const { store, connect, makeClient } = FSX.bridge;
  const { $, number, renderState, showSetup, notice, downloadCsv, showPause, today, errorText } = FSX.ui;

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

  // The progress screen keeps the last count and position while a later message (a pause, a
  // retry) only changes the text.
  let shown = {};
  const paint = (patch) => renderState((shown = { ...shown, ...patch }));

  function progressState(p) {
    if (p.phase === 'detail') {
      return { message: `Loading full details: ${number(p.enriched)} of ${number(p.total)} records`, count: `${number(p.total)} records`, page: p.enriched, totalPages: p.total };
    }
    return {
      message: `Page ${number(p.page)}${p.totalPages ? ` of ${number(p.totalPages)}` : ''} fetched`,
      count: `${number(p.fetched)} records`,
      page: p.page,
      totalPages: p.totalPages,
    };
  }

  async function runExport() {
    const view = picker && picker.current();
    if (running || !view) return;
    running = { aborted: false };
    const signal = running;
    view.viewName = view.viewName || `${view.endpoint}-view-${view.viewId}`;
    shown = {};
    try {
      paint({ status: 'running', title: `Exporting ${view.viewName}`, count: 'Starting…', message: 'Loading lookups…' });
      const fetcher = new ExportFetcher(makeClient(conn));
      const records = await fetcher.fetchViewRecords(view, view.viewId, {
        log,
        signal,
        enrichDetails: $('enrich').checked,
        onProgress: (p) => paint(progressState(p)),
      });
      if (!records.length) return paint({ status: 'done', count: 'No records', message: 'This view has no records.' });

      paint({ message: `Building the CSV for ${number(records.length)} records…` });
      const rows = flattenRecords(records, fetcher.registry);
      const columns = await chooseColumns(view, unionFieldnames(rows), records.length);
      if (!columns) return paint({ status: 'cancelled', title: 'Export cancelled', message: 'No file was saved.' });
      downloadCsv(toCsv(rows, columns), `${sanitizeFilename(view.viewName)} ${today()}.csv`);
      paint({ status: 'done', title: `Exported ${view.viewName}`, count: `${number(records.length)} records`, message: `${number(columns.length)} columns saved to your downloads.` });
    } catch (err) {
      log(errorText(err));
      const cancelled = /Export cancelled/.test(errorText(err));
      paint(cancelled ? { status: 'cancelled', title: 'Export cancelled', message: 'No file was saved.' } : { status: 'error', title: "Export didn't finish", message: friendlyError(errorText(err)) });
    } finally {
      running = null;
    }
  }

  function friendlyError(message) {
    if (/HTTP 429/.test(message)) return 'The export kept hitting the rate limit. Wait a minute and try again.';
    if (/HTTP 401|HTTP 403/.test(message)) {
      return 'Freshsales refused the request. Check the API key in the app settings, and that this user can see the view.';
    }
    if (/All paths failed/.test(message)) return 'Could not reach the list view API for this account. Details are in the browser console.';
    return message;
  }

  async function start() {
    try {
      conn = await connect();
    } catch (err) {
      $('account').textContent = 'Not connected';
      return notice(errorText(err));
    }
    $('account').textContent = `Connected to ${conn.host}`;
    conn.throttle.onWait = (ms) => running && showPause(ms);
    picker = FSX.views.setupViewPicker({
      host: conn.host,
      fetcher: new ExportFetcher(makeClient(conn)),
      onChange: (selection) => ($('export').disabled = !selection),
    });
    $('export').addEventListener('click', runExport);
    $('cancel').addEventListener('click', () => {
      if (running) running.aborted = true;
      paint({ message: 'Cancelling…' });
    });
    $('back').addEventListener('click', showSetup);
  }

  start();
})();
