// RFC 4180 CSV serialisation.
(function (root) {
  const FSX = (root.FSX = root.FSX || {});

  // CRM text (names, notes, web-form input) can start with = + - @ and would run as a formula
  // when the CSV is opened in Excel or Sheets. Prefix those with ' (OWASP CSV injection advice),
  // except number and phone shapes (-12.5, +44 1234 567 890) so those columns stay as they were.
  const FORMULA_START = /^[=+\-@\t\r]/;
  const PLAIN_NUMBER = /^[+-]?[\d ().-]+$/;

  function escapeCell(value) {
    if (value === null || value === undefined) return '';
    let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
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
