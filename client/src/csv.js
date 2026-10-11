const FIELDS = ['claimant', 'date', 'category', 'amount', 'currency', 'description', 'receiptAvailable'];

/**
 * Parse CSV text into claim objects using the header row.
 * - A double quote only opens a quoted field at the start of a cell, so 27" monitor stays literal.
 * - Excel's ";" delimiter is detected from the header row.
 * - Headers are matched loosely: "Amount (USD)" → amount, "Receipt available?" → receiptAvailable.
 */
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const keyFor = (h) => (h.startsWith('receipt') ? 'receiptAvailable' : FIELDS.find((f) => h.startsWith(f.toLowerCase())));
  const keys = header.map(keyFor);
  return nonEmpty.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]]).filter(([k]) => k)));
}
