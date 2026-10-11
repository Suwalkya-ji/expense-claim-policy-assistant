/** Non-blocking hints shown under fields; the server-side review is the source of truth. */
export function fieldHints(form, { currencies = [], receiptThresholdUSD = 25, today = new Date().toISOString().slice(0, 10) } = {}) {
  const h = {};
  const amount = form.amount.trim();
  if (amount && !/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(amount)) h.amount = 'Use digits with a dot for decimals, e.g. 42.50.';
  else if (amount && Number(amount.replace(/,/g, '')) <= 0) h.amount = 'Amount must be greater than 0.';
  if (form.date && form.date > today) h.date = 'This date is in the future — it will be flagged.';
  if (form.currency && currencies.length && !currencies.includes(form.currency.trim().toUpperCase())) h.currency = `Not supported (use ${currencies.join(', ')}).`;
  if (form.receiptAvailable === 'no' && Number(amount) >= receiptThresholdUSD) h.receiptAvailable = `Receipts are required from USD ${receiptThresholdUSD} (or the equivalent); this claim may be flagged.`;
  const missing = ['claimant', 'date', 'category', 'amount', 'currency', 'description', 'receiptAvailable'].filter((k) => !String(form[k]).trim());
  return { hints: h, missing };
}
