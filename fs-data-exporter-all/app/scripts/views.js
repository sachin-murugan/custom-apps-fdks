// The "which list view" part of the page: paste a list view address, or pick a module and one
// of its saved views. Shared by the apps that export list views.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});
  const { parseListViewUrl } = FSX.platform;
  const { $, show, fillSelect, errorText } = FSX.ui;

  const MODULES = [
    { value: 'contacts', label: 'Contacts', entity: 'contact', endpoint: 'contacts' },
    { value: 'sales_accounts', label: 'Accounts', entity: 'sales_account', endpoint: 'sales_accounts' },
    { value: 'deals', label: 'Deals', entity: 'deal', endpoint: 'deals' },
    { value: 'leads', label: 'Leads (classic Freshsales)', entity: 'lead', endpoint: 'leads' },
    { value: 'products', label: 'Products', entity: 'product', endpoint: 'products' },
    { value: 'cpq_documents', label: 'Documents (CPQ)', entity: 'cpq_document', endpoint: 'cpq_documents' },
    { value: 'custom', label: 'Custom module…' },
  ];

  /**
   * Wire up #url, #module, #custom and #view. `only` limits the modules offered (entity names).
   * `onChange(selection)` runs whenever the chosen view changes; selection is
   * { host, entity, endpoint, custom, viewId, viewName } or null. `acceptUrl(text)` lets the page
   * claim a pasted address that isn't a list view (return true to stop the "not a list view" hint).
   */
  function setupViewPicker({ host, fetcher, only, onChange, acceptUrl }) {
    const modules = only ? MODULES.filter((m) => only.includes(m.entity)) : MODULES;
    let views = [];
    let loadSeq = 0;

    const moduleFor = () => {
      const m = modules.find((x) => x.value === $('module').value);
      if (!m) return null;
      if (m.value !== 'custom') return { host, entity: m.entity, endpoint: m.endpoint, custom: false };
      const key = $('custom').value.trim();
      return key ? { host, entity: key, endpoint: key, custom: true } : null;
    };

    const current = () => {
      const mod = moduleFor();
      const viewId = $('view').value;
      if (!mod || !viewId) return null;
      const match = views.find((v) => v.id === viewId);
      return { ...mod, viewId, viewName: match ? match.name : null };
    };

    const changed = () => onChange(current());

    async function loadViews(selectId) {
      const seq = ++loadSeq;
      const mod = moduleFor();
      views = [];
      fillSelect($('view'), [], mod ? 'Loading views…' : 'Pick a module first');
      $('view').disabled = true;
      changed();
      if (!mod) return;
      try {
        const found = await fetcher.fetchViews(mod);
        if (seq !== loadSeq) return;
        views = found;
        fillSelect($('view'), views.map((v) => ({ value: v.id, label: v.name })), 'Choose a view');
        $('view').disabled = false;
      } catch (err) {
        if (seq !== loadSeq) return;
        console.debug('[FSX] views', errorText(err));
        fillSelect($('view'), [], "Couldn't load views for this module");
      }
      if (selectId) {
        // A pasted address can name a view that isn't in the saved list (e.g. a shared one).
        if (!views.some((v) => v.id === selectId)) $('view').append(new Option(`View ${selectId}`, selectId));
        $('view').value = selectId;
        $('view').disabled = false;
      }
      changed();
    }

    function useUrl() {
      const text = $('url').value.trim();
      if (!text) {
        $('url-hint').textContent = '';
        return;
      }
      if (acceptUrl && acceptUrl(text)) {
        $('url-hint').textContent = '';
        return;
      }
      const parsed = parseListViewUrl(text);
      const offered = parsed && (parsed.custom ? modules.some((m) => m.value === 'custom') : modules.some((m) => m.entity === parsed.entity));
      if (!offered) {
        $('url-hint').textContent = "That doesn't look like a list view address this app can export.";
        return;
      }
      $('url-hint').textContent = '';
      $('module').value = parsed.custom ? 'custom' : modules.find((m) => m.entity === parsed.entity).value;
      show($('custom-field'), parsed.custom);
      if (parsed.custom) $('custom').value = parsed.entity;
      loadViews(parsed.viewId);
    }

    fillSelect($('module'), modules, 'Choose a module');
    fillSelect($('view'), [], 'Pick a module first');
    $('module').addEventListener('change', () => {
      show($('custom-field'), $('module').value === 'custom');
      loadViews();
    });
    $('custom').addEventListener('change', () => loadViews());
    $('view').addEventListener('change', changed);
    $('url').addEventListener('input', useUrl);

    return { current };
  }

  FSX.views = { MODULES, setupViewPicker };
})(globalThis);
