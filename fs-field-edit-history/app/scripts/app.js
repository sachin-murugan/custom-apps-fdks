// FS Field Edit History as a Freshworks CRM app. Exports to CSV:
// - a list view: the field edit history of every record in the view,
// - a record: its field edit history, or its activity timeline,
// - a workflow: its action history.
// Opened from a contact, account or deal (entity menu) it works on that record; opened as a
// full page it asks which view, record or workflow. Field history progress is checkpointed in
// the browser so a failed or cancelled run resumes where it stopped.
(function () {
  const { ExportFetcher, mapWithConcurrency } = FSX.fetcher;
  const { toCsv, sanitizeFilename } = FSX.csv;
  const { store, connect } = FSX.bridge;
  const { $, show, renderState, downloadCsv, today, errorText } = FSX.ui;
  const H = FSX.history;
  const A = FSX.activity;

  const CONCURRENCY = 3;
  const BATCH = 20; // records per checkpoint
  const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;
  const ENTITY_MODULES = {
    contact: { entity: 'contact', endpoint: 'contacts' },
    deal: { entity: 'deal', endpoint: 'deals' },
    sales_account: { entity: 'sales_account', endpoint: 'sales_accounts' },
  };

  let running = null; // { aborted } while an export is in flight
  let conn = null;
  let target = null; // { kind: 'view' | 'record' | 'workflow', ... }
  let fields = [];
  let detectSeq = 0;

  const log = (msg) => console.debug('[FS Field Edit History]', msg);
  const makeClient = (onRetry) => FSX.bridge.makeClient(conn, { onRetry });

  // --- Checkpoint: { records: [{id,name}], idsDone, nextPage, done, chunks, at } + row chunks.
  const ckptKey = (t, opts) =>
    `feh:${conn.host}|${t.entity}|${t.viewId || `record-${t.recordId}`}|${opts.fromMs ?? ''}|${opts.toMs ?? ''}|${[...(opts.fields || [])].sort().join(',')}`;

  async function loadCkpt(key) {
    try {
      const { [key]: meta } = await store.get(key);
      if (!meta) return null;
      if (Date.now() - meta.at > CHECKPOINT_TTL_MS) {
        await clearCkpt(key);
        return null;
      }
      return meta;
    } catch (_e) {
      return null;
    }
  }

  async function loadRows(key, meta) {
    const keys = Array.from({ length: meta.chunks }, (_, i) => `${key}#${i}`);
    const got = keys.length ? await store.get(keys) : {};
    if (keys.some((k) => !Array.isArray(got[k]))) throw new Error('checkpoint incomplete');
    return keys.flatMap((k) => got[k]);
  }

  async function clearCkpt(key) {
    try {
      const { [key]: meta } = await store.get(key);
      const n = (meta && meta.chunks) || 0;
      await store.remove([key, ...Array.from({ length: n }, (_, i) => `${key}#${i}`)]);
    } catch (_e) {}
  }

  /** Saver that gives up (and drops the checkpoint) the first time the browser refuses a write. */
  function ckptSaver(key) {
    let working = true;
    return async (meta, rowsChunk) => {
      if (!working) return;
      meta.at = Date.now();
      try {
        if (rowsChunk) await store.set({ [`${key}#${meta.chunks - 1}`]: rowsChunk });
        await store.set({ [key]: meta });
      } catch (_e) {
        working = false; // usually the storage quota; the export itself carries on in memory
        await clearCkpt(key);
      }
    };
  }

  // --- What is selected, and what can be exported for it.
  async function describe(t) {
    const client = makeClient();
    if (t.kind === 'workflow') return { name: (await A.fetchWorkflowName(client, t.workflowId)) || `Workflow ${t.workflowId}`, fields: [] };
    const module = H.SUPPORTED[t.entity];
    const name = t.kind === 'view' ? t.viewName : await A.fetchRecordName(client, t, t.recordId);
    const tracked = await H.fetchTrackedFields(client, t).catch(() => []); // the timeline still works without them
    return { name: name || `${module} ${t.viewId || t.recordId}`, fields: tracked, module };
  }

  async function setTarget(next) {
    const seq = ++detectSeq;
    target = next;
    show($('form'), false);
    show($('error'), false);
    show($('hint'), true);
    if (!next) {
      $('hint').textContent = 'Choose what to export.';
      return;
    }
    $('hint').textContent = 'Loading…';
    let info;
    try {
      info = await describe(next);
    } catch (err) {
      if (seq === detectSeq) $('hint').textContent = friendlyError(errorText(err));
      return;
    }
    if (seq !== detectSeq) return;
    target = { ...next, name: info.name };
    show($('hint'), false);
    show($('form'), true);
    $('target-name').textContent = info.name;
    const isWorkflow = next.kind === 'workflow';
    fields = info.fields;
    $('target-label').textContent = isWorkflow ? 'Workflow' : next.kind === 'view' ? `${info.module} view` : `${info.module.replace(/s$/, '')} record`;
    show($('export-workflow'), isWorkflow);
    show($('export-timeline'), next.kind === 'record');
    show($('fields-section'), !isWorkflow && fields.length > 0);
    show($('export'), !isWorkflow && fields.length > 0);
    show($('pace'), next.kind === 'view' && fields.length > 0);
    if (fields.length) renderFields();
    else if (!isWorkflow) {
      $('error').textContent = `No fields are tracked for ${info.module}. An admin can turn on field tracking in the module's field settings.`;
      show($('error'), true);
    }
  }

  function renderFields() {
    $('fields').replaceChildren(
      ...fields.map((f) => {
        const label = document.createElement('label');
        const cb = Object.assign(document.createElement('input'), { type: 'checkbox', value: f.name, checked: true });
        label.append(cb, f.label);
        label.title = f.name;
        return label;
      })
    );
    $('field-count').textContent = `(${fields.length})`;
  }
  const boxes = () => [...$('fields').querySelectorAll('input[type=checkbox]')];
  const visibleBoxes = () => boxes().filter((b) => !b.parentElement.hidden);

  // Timeline and workflow history: one paged fetch, then a CSV (no checkpoint; these are small).
  async function runSimple(t, opts, signal, onRetry) {
    const client = makeClient(onRetry);
    const onPage = (n, rows) => {
      if (!signal.aborted) renderState({ status: 'running', message: `Fetched ${rows} entries (page ${n})…` });
    };
    const range = { fromMs: opts.fromMs, toMs: opts.toMs, signal, onPage };
    let rows, columns;
    if (opts.action === 'timeline') {
      rows = await A.fetchTimeline(client, t, t.recordId, range);
      columns = A.TIMELINE_COLUMNS;
    } else {
      rows = await A.fetchWorkflowHistory(client, t.workflowId, range);
      columns = A.WORKFLOW_COLUMNS;
    }
    const kind = opts.action === 'timeline' ? 'activity timeline' : 'action history';
    downloadCsv(toCsv(rows, columns), `${sanitizeFilename(`${t.name} ${kind}`)} ${today()}.csv`);
    renderState({ status: 'done', message: `Exported ${rows.length} ${opts.action === 'timeline' ? 'timeline entries' : 'workflow actions'}.` });
  }

  async function runExport(opts) {
    const t = target;
    if (running || !t) return;
    running = { aborted: false };
    const signal = running;
    const key = opts.action === 'history' ? ckptKey(t, opts) : null;
    let meta = null;
    try {
      let status = '';
      const onRetry = ({ reason, waitMs }) =>
        renderState({
          status: 'running',
          message: `${reason === 'rate_limit' ? 'Rate limit hit' : 'Connection problem'}, retrying in ${Math.ceil(waitMs / 1000)}s. ${status}`,
        });
      renderState({ status: 'running', message: 'Starting…' });
      if (opts.action !== 'history') return await runSimple(t, opts, signal, onRetry);

      const client = makeClient(onRetry);
      const fetcher = new ExportFetcher(client);
      const labels = Object.fromEntries(opts.labels.map((f) => [f.name, f.label]));
      const save = ckptSaver(key);
      let allRows = [];
      meta = await loadCkpt(key);
      if (meta) {
        try {
          allRows = await loadRows(key, meta);
        } catch (_e) {
          await clearCkpt(key);
          meta = null;
        }
      }
      if (!meta) {
        meta =
          t.kind === 'record'
            ? { records: [{ id: t.recordId, name: t.name }], idsDone: true, nextPage: 1, done: 0, chunks: 0 }
            : { records: [], idsDone: false, nextPage: 1, done: 0, chunks: 0 };
      }

      // 1. Every record id in the view (paged, checkpointed per page).
      if (!meta.idsDone) {
        status = `Collecting records: ${meta.records.length} so far`;
        renderState({ status: 'running', message: meta.records.length ? `Resuming: ${status}` : 'Collecting records in this view…' });
        await fetcher.fetchViewRecords(t, t.viewId, {
          log,
          signal,
          startPage: meta.nextPage,
          onProgress: (p) => {
            status = `Collecting records: ${p.fetched} so far`;
            renderState({ status: 'running', message: status, page: p.page, totalPages: p.totalPages });
          },
          onPageRecords: async (page, records) => {
            meta.records.push(...records.filter((r) => r && ![null, undefined].includes(r.id)).map((r) => ({ id: r.id, name: H.recordName(r) })));
            meta.nextPage = page + 1;
            await save(meta);
          },
        });
        // Ids can repeat across pages if the view changes mid-run; each record is fetched once.
        const seen = new Set();
        meta.records = meta.records.filter((r) => !seen.has(r.id) && seen.add(r.id));
        meta.idsDone = true;
        await save(meta);
      }

      // 2. Field edit history of each record, in checkpointed batches.
      const total = meta.records.length;
      while (meta.done < total) {
        if (signal.aborted) throw new Error('Export cancelled');
        const batch = meta.records.slice(meta.done, meta.done + BATCH);
        let finished = meta.done;
        let found = 0;
        const results = await mapWithConcurrency(batch, CONCURRENCY, async (rec) => {
          const changes = await H.fetchRecordHistory(client, t, rec.id, { fields: opts.fields, fromMs: opts.fromMs, toMs: opts.toMs, signal });
          if (signal.aborted) throw new Error('Export cancelled'); // don't report after a cancel
          finished += 1;
          found += changes.length;
          status = `History: ${finished} of ${total} records, ${allRows.length + found} changes`;
          renderState({ status: 'running', message: status, page: finished, totalPages: total });
          return H.toRows(rec, changes, labels);
        });
        const rows = results.flat();
        allRows.push(...rows);
        meta.done += batch.length;
        meta.chunks += 1;
        await save(meta, rows);
      }

      if (!total) {
        renderState({ status: 'done', message: 'This view has no records.' });
      } else {
        downloadCsv(toCsv(allRows, H.COLUMNS), `${sanitizeFilename(t.name)} field edit history ${today()}.csv`);
        renderState({ status: 'done', message: `Exported ${allRows.length} changes from ${total} records.` });
      }
      await clearCkpt(key);
    } catch (err) {
      const message = errorText(err);
      log(message);
      const saved = key && (await loadCkpt(key));
      const kept = saved ? (saved.idsDone ? `${saved.done} of ${saved.records.length} records done` : `${saved.records.length} records collected`) : '';
      renderState({
        status: 'error',
        message: `${friendlyError(message)}${kept ? ` Progress is saved (${kept}); export again with the same settings to resume.` : ''}`,
      });
    } finally {
      running = null;
    }
  }

  function friendlyError(message) {
    if (/Export cancelled/.test(message)) return 'Export cancelled.';
    if (/HTTP 429/.test(message)) return 'The export kept hitting the rate limit. Wait a minute and try again.';
    if (/HTTP 401|HTTP 403/.test(message)) {
      return 'Freshsales refused the request. Check the domain and API key in the app settings, and that this user is allowed to see these records.';
    }
    if (/field_history_unavailable/.test(message)) return "This Freshsales account doesn't return field edit history. The feature may not be on its plan.";
    if (/HTTP 400/.test(message)) return `Freshsales rejected the request: ${message}`;
    if (/All paths failed|HTTP 404|non-JSON/.test(message)) {
      return `Freshsales didn't answer this request for the API key. This screen's data may only be available to a logged-in browser session. Details: ${message}`;
    }
    return message;
  }

  const toMs = (value) => (value ? new Date(value).getTime() : null);
  function range() {
    const fromMs = toMs($('from').value);
    const to = toMs($('to').value);
    if (![null, undefined].includes(fromMs) && ![null, undefined].includes(to) && fromMs > to) {
      renderState({ status: 'error', message: '"From" is after "To".' });
      return null;
    }
    return { fromMs, toMs: to };
  }

  function wireForm() {
    $('field-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      boxes().forEach((b) => (b.parentElement.hidden = Boolean(q) && !b.parentElement.textContent.toLowerCase().includes(q) && !b.value.includes(q)));
    });
    $('all').addEventListener('click', (e) => {
      e.preventDefault();
      visibleBoxes().forEach((b) => (b.checked = true));
    });
    $('none').addEventListener('click', (e) => {
      e.preventDefault();
      visibleBoxes().forEach((b) => (b.checked = false));
    });
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const chosen = boxes().filter((b) => b.checked).map((b) => b.value);
      if (!chosen.length) return renderState({ status: 'error', message: 'Pick at least one field.' });
      const r = range();
      if (r) runExport({ action: 'history', fields: chosen, labels: fields.filter((f) => chosen.includes(f.name)), ...r });
    });
    $('export-timeline').addEventListener('click', () => {
      const r = range();
      if (r) runExport({ action: 'timeline', ...r });
    });
    $('export-workflow').addEventListener('click', () => {
      const r = range();
      if (r) runExport({ action: 'workflow', ...r });
    });
    $('cancel').addEventListener('click', () => {
      if (running) running.aborted = true;
    });
  }

  /** The record this app was opened on (entity menu placements), or null on the full page. */
  async function recordFromPage(fw) {
    try {
      const data = await fw.data.get('currentEntityInfo');
      const info = data && data.currentEntityInfo;
      const mod = info && ENTITY_MODULES[info.currentEntityType];
      return mod && info.currentEntityId ? { kind: 'record', host: conn.host, ...mod, recordId: String(info.currentEntityId) } : null;
    } catch (_e) {
      return null;
    }
  }

  async function start() {
    try {
      conn = await connect();
    } catch (err) {
      $('account').textContent = '';
      return renderState({ status: 'error', message: errorText(err) });
    }
    $('account').textContent = `Connected to ${conn.host}`;
    wireForm();

    const record = await recordFromPage(conn.fw);
    if (record) {
      show($('picker'), false);
      return setTarget(record);
    }

    let fromUrl = false;
    FSX.views.setupViewPicker({
      host: conn.host,
      fetcher: new ExportFetcher(makeClient()),
      only: Object.keys(H.SUPPORTED),
      onChange: (selection) => {
        if (selection || !fromUrl) setTarget(selection ? { kind: 'view', ...selection } : null);
        if (selection) fromUrl = false;
      },
      // Record and workflow addresses are handled here; list views go to the picker.
      acceptUrl: (text) => {
        const rec = A.parseRecordUrl(text);
        const wf = !rec && A.parseWorkflowUrl(text);
        if (!rec && !wf) return false;
        fromUrl = true;
        setTarget(rec ? { kind: 'record', ...rec, host: conn.host } : { kind: 'workflow', ...wf, host: conn.host });
        return true;
      },
    });
  }

  start();
})();
