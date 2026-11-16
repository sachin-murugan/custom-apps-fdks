// In-page dialog for choosing CSV columns. Lives in a shadow root so the Freshsales
// page styles can't reach it, and in the page (not the popup) so it survives the
// popup closing during a long export.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  const STYLE = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; background: rgba(18,52,77,.55); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      font: 14px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .dialog { background: #fff; color: #12344d; width: min(480px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 32px));
      display: flex; flex-direction: column; border-radius: 8px; box-shadow: 0 8px 24px rgba(18,52,77,.24); }
    header { padding: 16px 24px 12px; }
    h2 { font-size: 16px; line-height: 24px; font-weight: 600; margin: 0 0 2px; }
    .muted { color: #475867; font-size: 12px; }
    .tools { display: flex; gap: 12px; align-items: center; padding: 0 24px 12px; }
    input[type=search] { flex: 1; height: 32px; padding: 4px 12px; border: 1px solid #cfd7df; border-radius: 4px; font: inherit; color: inherit; }
    input[type=search]:focus { outline: none; border-color: #2c5cc5; box-shadow: 0 0 0 1px #2c5cc5; }
    input[type=checkbox] { accent-color: #2c5cc5; }
    .link { background: none; border: 0; color: #2c5cc5; cursor: pointer; font: inherit; font-weight: 600; padding: 0; }
    ul { list-style: none; margin: 0; padding: 8px 24px; overflow: auto; flex: 1; border-top: 1px solid #ebeff3; border-bottom: 1px solid #ebeff3; }
    li label { display: flex; gap: 8px; align-items: center; padding: 4px 0; cursor: pointer; word-break: break-all; }
    footer { display: flex; gap: 12px; justify-content: flex-end; padding: 12px 24px; background: #f5f7f9; border-radius: 0 0 8px 8px; }
    footer button { min-height: 32px; padding: 5px 12px; border-radius: 4px; border: 1px solid #cfd7df;
      background: linear-gradient(180deg, #fff 2.56%, #f3f5f7 95.75%); color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
    footer .primary { background: #2c5cc5; border-color: #2c5cc5; color: #fff; }
    footer .primary:hover { background: #283da5; }
    footer .primary:disabled { background: #ebeff3; border-color: #ebeff3; color: #92a2b1; cursor: not-allowed; }
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
