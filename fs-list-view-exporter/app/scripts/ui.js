// Small UI helpers shared by the app pages: progress, errors and the CSV download.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const $ = (id) => document.getElementById(id);
  const show = (el, visible) => {
    if (el) el.hidden = !visible;
  };

  /** state: { status: 'running' | 'done' | 'error', message, page, totalPages } */
  function renderState(state) {
    const running = state.status === 'running';
    show($('progress'), running || state.status === 'done');
    show($('cancel'), running);
    document.querySelectorAll('[data-busy-disable]').forEach((el) => (el.disabled = running));
    $('progress-text').textContent = state.status === 'error' ? '' : state.message || '';
    const fill = $('bar-fill');
    const known = running && state.totalPages;
    fill.classList.toggle('indeterminate', running && !state.totalPages);
    fill.style.width = known ? `${Math.min(100, Math.round((state.page / state.totalPages) * 100))}%` : state.status === 'done' ? '100%' : '';
    show($('error'), state.status === 'error');
    if (state.status === 'error') $('error').textContent = state.message;
  }

  /**
   * Start the download and leave a link behind: if the browser blocks a download started from
   * an embedded app, the user can still click it.
   */
  function downloadCsv(csv, filename) {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = $('download');
    if (link.href) URL.revokeObjectURL(link.href);
    link.href = url;
    link.download = filename;
    link.textContent = `Download ${filename}`;
    show(link, true);
    link.click();
  }

  function fillSelect(select, options, placeholder) {
    select.replaceChildren();
    if (placeholder) select.append(new Option(placeholder, ''));
    options.forEach((o) => select.append(new Option(o.label, o.value)));
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const errorText = (err) => (err && err.message ? err.message : String(err));

  FSX.ui = { $, show, renderState, downloadCsv, fillSelect, today, errorText };
})(globalThis);
