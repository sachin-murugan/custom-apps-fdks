// In-page dialog for choosing CSV columns. Lives in a shadow root so the Freshsales
// page styles can't reach it, and in the page (not the popup) so it survives the
// popup closing during a long export.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  const STYLE = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; background: rgba(17,24,39,.45); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .dialog { background: #fff; color: #111827; width: min(460px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 32px));
      display: flex; flex-direction: column; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    header { padding: 14px 16px 8px; }
    h2 { font-size: 15px; margin: 0 0 2px; }
    .muted { color: #6b7280; }
    .tools { display: flex; gap: 8px; padding: 0 16px 8px; }
    input[type=search] { flex: 1; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; }
    .link { background: none; border: 0; color: #2563eb; cursor: pointer; font: inherit; padding: 0 2px; }
    ul { list-style: none; margin: 0; padding: 4px 16px; overflow: auto; flex: 1; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
    li label { display: flex; gap: 8px; align-items: center; padding: 3px 0; cursor: pointer; word-break: break-all; }
    footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; }
    footer button { padding: 7px 14px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; color: inherit; font: inherit; cursor: pointer; }
    footer .primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
    footer .primary:disabled { opacity: .5; cursor: default; }
    @media (prefers-color-scheme: dark) {
      .dialog { background: #111827; color: #f3f4f6; }
      .muted { color: #9ca3af; }
      input[type=search], footer button { background: #1f2937; border-color: #374151; color: inherit; }
      ul { border-color: #374151; }
      .link { color: #60a5fa; }
    }
  `;

  /**
   * Show the picker and resolve with the chosen Set, or null if the user cancels.
   * `columns` is the full ordered list, `initial` the Set that starts ticked.
   */
  function pickColumns({ columns, initial, recordCount, viewName }) {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.setAttribute('data-fsx-column-picker', '');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>${STYLE}</style>
        <div class="backdrop">
          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="t">
            <header>
              <h2 id="t">Choose columns</h2>
              <div class="muted" id="sub"></div>
            </header>
            <div class="tools">
              <input type="search" id="filter" placeholder="Filter columns" />
              <button class="link" id="all">All</button>
              <button class="link" id="none">None</button>
            </div>
            <ul id="list"></ul>
            <footer>
              <button id="cancel">Cancel</button>
              <button class="primary" id="ok"></button>
            </footer>
          </div>
        </div>`;
      const $ = (id) => shadow.getElementById(id);
      const selected = new Set(initial);
      $('sub').textContent = `${viewName} · ${recordCount} records · ${columns.length} columns`;

      const items = columns.map((col) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = selected.has(col);
        box.addEventListener('change', () => {
          if (box.checked) selected.add(col);
          else selected.delete(col);
          refresh();
        });
        label.append(box, document.createTextNode(col));
        li.appendChild(label);
        $('list').appendChild(li);
        return { col, li, box };
      });

      function visible() {
        return items.filter((it) => !it.li.hidden);
      }
      function refresh() {
        $('ok').textContent = `Download ${selected.size} column${selected.size === 1 ? '' : 's'}`;
        $('ok').disabled = selected.size === 0;
      }
      function setAll(on) {
        for (const it of visible()) {
          it.box.checked = on;
          if (on) selected.add(it.col);
          else selected.delete(it.col);
        }
        refresh();
      }
      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(null);
        }
      }

      $('filter').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        for (const it of items) it.li.hidden = q && !it.col.toLowerCase().includes(q);
      });
      $('all').addEventListener('click', () => setAll(true));
      $('none').addEventListener('click', () => setAll(false));
      $('cancel').addEventListener('click', () => close(null));
      $('ok').addEventListener('click', () => close(new Set(selected)));
      document.addEventListener('keydown', onKey, true);

      refresh();
      document.documentElement.appendChild(host);
      $('filter').focus();
    });
  }

  FSX.columnPicker = { pickColumns };
})(globalThis);
