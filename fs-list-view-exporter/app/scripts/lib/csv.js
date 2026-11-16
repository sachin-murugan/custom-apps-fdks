// RFC 4180 CSV serialisation.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  function escapeCell(value) {
    if (value === null || value === undefined) return '';
    const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /**
   * Build a CSV string. A UTF-8 byte-order mark is prepended by default so Excel
   * opens non-ASCII names correctly.
   */
  function toCsv(rows, fieldnames, { bom = true } = {}) {
    const lines = [fieldnames.map(escapeCell).join(',')];
    for (const row of rows) lines.push(fieldnames.map((f) => escapeCell(row[f])).join(','));
    return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  }

  function sanitizeFilename(name) {
    return String(name || 'export').replace(/[\\/*?:"<>|]/g, '_').trim() || 'export';
  }

  FSX.csv = { escapeCell, toCsv, sanitizeFilename };
})(globalThis);
