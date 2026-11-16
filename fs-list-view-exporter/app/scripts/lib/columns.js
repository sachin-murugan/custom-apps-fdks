// Column selection for the CSV: which columns start ticked, and remembering the choice.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  /**
   * Work out which columns start ticked. `saved` is { selected, seen } from a previous
   * export of the same module, or null. Columns chosen last time stay ticked, columns
   * unticked last time stay unticked, and columns never seen before start ticked.
   */
  function initialSelection(columns, saved) {
    if (!saved || !Array.isArray(saved.selected)) return new Set(columns);
    const selected = new Set(saved.selected);
    const seen = new Set(saved.seen || saved.selected);
    const out = new Set(columns.filter((c) => selected.has(c) || !seen.has(c)));
    // A saved choice that no longer matches anything would give an empty CSV.
    return out.size ? out : new Set(columns);
  }

  /** Keep the original column order, restricted to the chosen set. */
  function applySelection(columns, selected) {
    return columns.filter((c) => selected.has(c));
  }

  /** Merge this export's choice into what was saved, so columns absent from this view keep their state. */
  function rememberSelection(columns, selected, saved) {
    const prevSelected = new Set((saved && saved.selected) || []);
    const seen = new Set((saved && (saved.seen || saved.selected)) || []);
    for (const c of columns) {
      seen.add(c);
      if (selected.has(c)) prevSelected.add(c);
      else prevSelected.delete(c);
    }
    return { selected: [...prevSelected], seen: [...seen] };
  }

  function prefsKey(host, entity) {
    return `${String(host).toLowerCase()}|${entity}`;
  }

  FSX.columns = { initialSelection, applySelection, rememberSelection, prefsKey };
})(globalThis);
