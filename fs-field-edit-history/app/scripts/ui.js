// Page helpers shared by the apps: the export progress screen, form messages and the download.
// The page has two parts: #setup (what to export) and #run (progress, result, errors).
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const $ = (id) => document.getElementById(id);
  const show = (el, visible) => {
    if (el) el.hidden = !visible;
  };
  const number = (n) => Number(n).toLocaleString();

  /** "1 min 20 s", "45 s", "2 h 5 min" */
  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
    return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  }

  let startedAt = 0;
  let fraction = 0; // 0..1 when the total is known
  let ticker = null;

  function renderTime() {
    const elapsed = Date.now() - startedAt;
    // The estimate is only shown once enough has run for it to mean something.
    const left = fraction > 0.02 && fraction < 1 && elapsed > 5000 ? `About ${duration((elapsed * (1 - fraction)) / fraction)} left · ` : '';
    $('run-time').textContent = `${left}${duration(elapsed)} elapsed`;
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  /**
   * state: { status: 'running' | 'done' | 'error', message, title?, count?, page?, totalPages? }
   * `count` is the headline ("3,200 records"); page / totalPages drive the bar and the estimate.
   */
  function renderState(state) {
    const running = state.status === 'running';
    show($('setup'), false);
    show($('run'), true);
    hideNotice();
    if (state.title) $('run-title').textContent = state.title;
    if (running && !ticker) {
      startedAt = Date.now();
      fraction = 0;
      show($('download'), false);
      ticker = setInterval(renderTime, 1000);
    }
    if (!running) {
      stopTicker();
      clearTimeout(pauseTimer);
      show($('run-pause'), false);
    }

    const known = running && state.totalPages > 0;
    fraction = known ? Math.min(1, state.page / state.totalPages) : state.status === 'done' ? 1 : fraction;
    const fill = $('bar-fill');
    fill.classList.toggle('indeterminate', running && !known);
    fill.classList.toggle('done', state.status === 'done');
    fill.classList.toggle('failed', state.status === 'error');
    fill.classList.toggle('stopped', state.status === 'cancelled');
    fill.style.width = running && !known ? '' : `${Math.round(fraction * 100)}%`;
    $('bar').setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    $('run-percent').textContent = known ? `${Math.round(fraction * 100)}%` : '';
    if (state.count !== undefined) $('run-count').textContent = state.count;
    if (running && state.count === undefined && !$('run-count').textContent) $('run-count').textContent = 'Starting…';
    if (!running && $('run-count').textContent === 'Starting…') $('run-count').textContent = ''; // failed before the first page

    $('progress-text').textContent = state.status === 'error' ? '' : state.message || '';
    if (running) renderTime();
    show($('run-time'), running);
    show($('cancel'), running);
    show($('back'), !running);
    show($('error'), state.status === 'error');
    if (state.status === 'error') $('error').textContent = state.message;
    $('run').dataset.status = state.status;
  }

  /** Back to the form after an export. */
  function showSetup() {
    stopTicker();
    show($('run'), false);
    show($('setup'), true);
    $('run-count').textContent = '';
    $('run-percent').textContent = '';
  }

  /** A message on the form itself (nothing is running): a missing choice, a failed lookup. */
  function notice(message) {
    $('notice').textContent = message;
    show($('notice'), true);
  }
  function hideNotice() {
    show($('notice'), false);
  }

  /**
   * Start the download and leave a button behind: if the browser blocks a download started
   * from an embedded app, the user can still click it.
   */
  function downloadCsv(csv, filename) {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = $('download');
    if (link.href) URL.revokeObjectURL(link.href);
    link.href = url;
    link.download = filename;
    link.textContent = `Download again (${filename})`;
    show(link, true);
    link.click();
  }

  function fillSelect(select, options, placeholder) {
    select.replaceChildren();
    if (placeholder) select.append(new Option(placeholder, ''));
    options.forEach((o) => select.append(new Option(o.label, o.value)));
  }

  // A rate-limit pause is shown under the progress line for as long as it lasts.
  let pauseTimer = null;
  function showPause(ms) {
    const box = $('run-pause');
    box.textContent = `Pausing ${duration(ms)} to stay within the app platform's limit of 50 requests a minute. The export carries on by itself.`;
    show(box, true);
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => show(box, false), ms);
  }

  // Local date: a file saved at 3 AM in India is named for that day, not yesterday's UTC date.
  const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const errorText = (err) => (err && err.message ? err.message : String(err));

  FSX.ui = { $, show, number, duration, renderState, showSetup, notice, hideNotice, downloadCsv, fillSelect, showPause, today, errorText };
})(globalThis);
