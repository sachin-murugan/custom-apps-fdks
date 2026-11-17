// FS Data Exporter as a Freshworks CRM app. Exports a saved list view, or account data
// (marketing lists, segments, sequences, workflows, users, reports list, campaigns, journeys,
// tasks, meetings, ...) to CSV. Every request goes through the platform's Request Method with
// the API key from the app settings. Progress is checkpointed in the browser so a failed
// export resumes where it stopped.
(function () {
  const { detectPage, fetchAction, ACTIONS } = FSX.pages;
  const { ExportFetcher } = FSX.fetcher;
  const { flattenRecords, unionFieldnames } = FSX.flatten;
  const { toCsv, sanitizeFilename } = FSX.csv;
  const { initialSelection, applySelection, rememberSelection, prefsKey } = FSX.columns;
  const { pickColumns } = FSX.columnPicker;
  const { store, connect, makeClient } = FSX.bridge;
  const { $, number, renderState, showSetup, notice, downloadCsv, fillSelect, showPause, today, errorText } = FSX.ui;

  // Exports that need nothing but the account. The rest belong to one page (a list, a segment…)
  // and are offered when that page's address is pasted.
  const ACCOUNT_ACTIONS = [
    'users',
    'lists',
    'segments',
    'sales_sequences',
    'workflows',
    'reports',
    'email_campaigns',
    'transactional_campaigns',
    'social_campaigns',
    'journeys',
    'tasks',
    'meetings',
    'sales_activities',
  ];
  // Not possible from an app: these read the open page's HTML or the analytics app's own session,
  // or call the marketing API (/crm/marketer/...), which answers an API key with its login page.
  const NO_CLIENT = { apiPaths: () => [], settingsPaths: () => [], selectorPaths: () => [] };
  const marketer = (key) => {
    try {
      return (ACTIONS[key].paths ? ACTIONS[key].paths(NO_CLIENT, '0') : []).some((p) => String(p).startsWith('/crm/marketer'));
    } catch {
      return false;
    }
  };
  const unsupported = (key) => Boolean(ACTIONS[key].dom || ACTIONS[key].analytics || marketer(key));

  let running = null; // { aborted } while an export is in flight
  let picker = null;
  let conn = null;
  let pageJobs = []; // jobs offered by the pasted page address

  const log = (msg) => console.debug('[FS Data Exporter]', msg);
  const makeFetcher = (onRetry) => new ExportFetcher(makeClient(conn, { onRetry }));

  async function chooseColumns(entity, columns, recordCount, viewName) {
    if (!$('ask-columns').checked) return columns;
    const key = prefsKey(conn.host, entity);
    let prefs = {};
    try {
      ({ columnPrefs: prefs = {} } = await store.get('columnPrefs'));
    } catch {}
    const chosen = await pickColumns({ columns, initial: initialSelection(columns, prefs[key]), recordCount, viewName });
    if (!chosen) return null;
    try {
      prefs[key] = rememberSelection(columns, chosen, prefs[key]);
      await store.set({ columnPrefs: prefs });
    } catch {}
    return applySelection(columns, chosen);
  }

  // --- Checkpoints: each fetched page is saved, so a failed export resumes where it stopped.
  // The optional full-details pass isn't checkpointed; it re-runs after a resume.
  const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;
  const ckptKey = (job) => `ckpt:${conn.host}|${job.key}|${job.view ? `${job.view.entity}|${job.view.viewId || job.view.listId}` : job.id || ''}`;

  async function loadMeta(key) {
    try {
      const { [key]: meta } = await store.get(key);
      if (meta && Date.now() - meta.at > CHECKPOINT_TTL_MS) {
        await clearCheckpoint(key);
        return null;
      }
      return meta || null;
    } catch {
      return null;
    }
  }

  async function loadCheckpoint(key) {
    const meta = await loadMeta(key);
    if (!meta || !meta.pages.length) return null;
    try {
      const chunkKeys = meta.pages.map((p) => `${key}#${p}`);
      const chunks = await store.get(chunkKeys);
      // A missing chunk would leave a hole in the export; start over instead.
      if (chunkKeys.some((k) => !Array.isArray(chunks[k]))) {
        await clearCheckpoint(key);
        return null;
      }
      return { nextPage: Math.max(...meta.pages) + 1, records: chunkKeys.flatMap((k) => chunks[k]) };
    } catch {
      return null;
    }
  }

  /** Returns a page saver that stops (and drops the checkpoint) the first time the browser refuses a write. */
  function pageSaver(key) {
    let working = true;
    return async (page, records) => {
      if (!working) return;
      try {
        const meta = (await loadMeta(key)) || { pages: [], count: 0 };
        if (!meta.pages.includes(page)) meta.pages.push(page);
        meta.count += records.length;
        meta.at = Date.now();
        await store.set({ [`${key}#${page}`]: records });
        await store.set({ [key]: meta });
      } catch {
        // Usually the storage quota on a very large export. Carry on without resume.
        working = false;
        await clearCheckpoint(key);
      }
    };
  }

  async function clearCheckpoint(key) {
    try {
      const { [key]: meta } = await store.get(key);
      await store.remove([key, ...((meta && meta.pages) || []).map((p) => `${key}#${p}`)]);
    } catch {}
  }

  async function savedCount(key) {
    const meta = await loadMeta(key);
    return meta ? meta.count : 0;
  }

  // The progress screen keeps the last count and position while a later message (a pause, a
  // retry) only changes the text.
  let shown = {};
  const paint = (patch) => renderState((shown = { ...shown, ...patch }));

  /** job: { key, label, id?, view? } */
  async function runExport(job) {
    if (running || !job) return;
    const def = ACTIONS[job.key];
    running = { aborted: false };
    const signal = running;
    const key = ckptKey(job);
    const view = def.view ? job.view : null;
    const name = view && !view.listId ? view.viewName || `${view.endpoint}-view-${view.viewId}` : job.label;
    shown = {};
    try {
      const onRetry = ({ reason, waitMs }) =>
        paint({ message: `${reason === 'rate_limit' ? 'Rate limit hit' : 'Connection problem'}, trying again in ${Math.ceil(waitMs / 1000)} s…` });
      const fetcher = makeFetcher(onRetry);
      const saved = await loadCheckpoint(key);
      const resume = saved ? { startPage: saved.nextPage, initial: saved.records } : {};
      paint({
        status: 'running',
        title: `Exporting ${name}`,
        count: saved ? `${number(saved.records.length)} records` : 'Starting…',
        message: saved ? 'Picking up where the last run stopped…' : 'Loading lookups…',
      });
      const onProgress = (p) =>
        paint(
          p.phase === 'detail'
            ? { message: `Loading full details: ${number(p.enriched)} of ${number(p.total)} records`, count: `${number(p.total)} records`, page: p.enriched, totalPages: p.total }
            : {
                message: `Page ${number(p.page)}${p.totalPages ? ` of ${number(p.totalPages)}` : ''} fetched`,
                count: `${number(p.fetched)} records`,
                page: p.page,
                totalPages: p.totalPages,
              }
        );
      const onPageRecords = pageSaver(key);

      let records;
      let columnsKey;
      if (view) {
        columnsKey = view.entity;
        records = await fetcher.fetchViewRecords(view, view.viewId, {
          log,
          signal,
          enrichDetails: !view.listId && $('enrich').checked,
          onProgress,
          onPageRecords,
          ...resume,
        });
      } else {
        columnsKey = `page:${job.key}`;
        await fetcher.registry.loadSelectors(fetcher.client, log, FSX.lookups.selectorsFor(null));
        records = await fetchAction(fetcher.client, job.key, job.id, { signal, onPage: onProgress, onPageRecords, ...resume });
      }

      if (!records.length) {
        await clearCheckpoint(key);
        return paint({ status: 'done', count: 'No records', message: 'There is nothing to export here.' });
      }
      paint({ message: `Building the CSV for ${number(records.length)} records…` });
      const rows = flattenRecords(records, fetcher.registry);
      const columns = await chooseColumns(columnsKey, unionFieldnames(rows), records.length, name);
      if (!columns) {
        return paint({ status: 'cancelled', title: 'Export cancelled', message: 'No file was saved. The fetched records are kept, so exporting again is quick.' });
      }
      downloadCsv(toCsv(rows, columns), `${sanitizeFilename(name)} ${today()}.csv`);
      await clearCheckpoint(key);
      paint({ status: 'done', title: `Exported ${name}`, count: `${number(records.length)} records`, message: `${number(columns.length)} columns saved to your downloads.` });
    } catch (err) {
      const message = errorText(err);
      log(message);
      const kept = await savedCount(key);
      const resumeNote = kept ? ` ${number(kept)} records are saved; export again to pick up from there.` : '';
      if (/Export cancelled/.test(message)) paint({ status: 'cancelled', title: 'Export cancelled', message: `No file was saved.${resumeNote}` });
      else paint({ status: 'error', title: "Export didn't finish", message: friendlyError(message, def) + resumeNote });
    } finally {
      running = null;
    }
  }

  function friendlyError(message, def) {
    if (/HTTP 429/.test(message)) return 'The export kept hitting the rate limit. Wait a minute and try again.';
    if (/feature_not_available/.test(message)) return `${def.label} isn't available on this Freshsales plan.`;
    if (/HTTP 401|HTTP 403/.test(message)) {
      return 'Freshsales refused the request. Check the API key in the app settings, and that this user is allowed to see this.';
    }
    if (/All paths failed/.test(message)) return `${def.label} couldn't be reached with the API key on this account. Details are in the browser console.`;
    return message;
  }

  // --- "Export account data": the account-wide list, plus whatever the pasted page offers.
  function renderActions() {
    const options = [
      ...pageJobs.map((j, i) => ({ value: `page:${i}`, label: j.label })),
      ...ACCOUNT_ACTIONS.filter((key) => !unsupported(key)).map((key) => ({ value: key, label: ACTIONS[key].label })),
    ];
    fillSelect($('action'), options, 'Choose an export');
    if (pageJobs.length) $('action').value = 'page:0';
    $('export-action').disabled = !$('action').value;
  }

  function selectedJob() {
    const value = $('action').value;
    if (!value) return null;
    if (value.startsWith('page:')) return pageJobs[Number(value.slice(5))];
    return { key: value, label: ACTIONS[value].label };
  }

  function usePageUrl() {
    const text = $('page-url').value.trim();
    pageJobs = [];
    $('page-hint').textContent = '';
    if (text) {
      const page = detectPage(text);
      const actions = page ? page.actions.filter((a) => !unsupported(a.key) && !ACCOUNT_ACTIONS.includes(a.key) && a.key !== 'view_records') : [];
      if (page && page.actions.some((a) => a.key === 'view_records')) {
        $('page-hint').textContent = 'That is a list view. Paste it in the box at the top instead.';
      } else if (!actions.length) {
        const marketing = page && page.actions.some((a) => marketer(a.key));
        $('page-hint').textContent = marketing
          ? `${page.title} can't be exported from the app: Freshworks' marketing API doesn't accept API keys. Use the browser extension for it.`
          : page
            ? `Nothing extra to export for that page (${page.title}).`
            : "That address isn't a page this app knows.";
      } else {
        pageJobs = actions.map((a) => ({
          key: a.key,
          label: `${a.label}${page.id ? ` (${page.title} ${page.id})` : ''}`,
          id: page.id,
          view: ACTIONS[a.key].view ? { ...page.view, host: conn.host } : undefined,
        }));
      }
    }
    renderActions();
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
      fetcher: makeFetcher(),
      onChange: (selection) => ($('export-view').disabled = !selection),
    });
    renderActions();
    $('action').addEventListener('change', () => ($('export-action').disabled = !$('action').value));
    $('page-url').addEventListener('input', usePageUrl);
    $('export-view').addEventListener('click', () => {
      const view = picker.current();
      if (view) runExport({ key: 'view_records', label: ACTIONS.view_records.label, view });
    });
    $('export-action').addEventListener('click', () => runExport(selectedJob()));
    $('cancel').addEventListener('click', () => {
      if (running) running.aborted = true;
      paint({ message: 'Cancelling…' });
    });
    $('back').addEventListener('click', showSetup);
  }

  start();
})();
