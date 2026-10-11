import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../../client/src/csv.js';

test('CSV: literal quotes, quoted commas, loose headers', () => {
  const rows = parseCsv('claimant,date,category,Amount (USD),currency,description,Receipt available?\nAna,2026-10-01,Office,30,USD,27" monitor cable,yes\nBo,2026-10-02,Meals,12,USD,"Lunch, with client",no\n');
  assert.equal(rows.length, 2, 'a stray quote does not swallow the next row');
  assert.equal(rows[0].description, '27" monitor cable');
  assert.equal(rows[0].amount, '30');
  assert.equal(rows[0].receiptAvailable, 'yes');
  assert.equal(rows[1].description, 'Lunch, with client');
});

test('CSV: Excel semicolon delimiter, CRLF and escaped quotes', () => {
  assert.deepEqual(parseCsv('claimant;date;amount\r\nAna;2026-10-01;"12,50"\r\n'), [{ claimant: 'Ana', date: '2026-10-01', amount: '12,50' }]);
  assert.equal(parseCsv('claimant,description\nAna,"Said ""hi"" twice"\n')[0].description, 'Said "hi" twice');
});

test('form hints flag bad amounts, future dates, currencies and missing fields', async () => {
  const { fieldHints } = await import('../../client/src/fieldHints.js');
  const base = { claimant: 'Ana', date: '2026-10-01', category: 'Meals', amount: '42.50', currency: 'USD', description: 'Lunch', receiptAvailable: 'yes' };
  const opts = { currencies: ['USD', 'EUR'], today: '2026-10-10' };
  assert.deepEqual(fieldHints(base, opts), { hints: {}, missing: [] });
  const bad = fieldHints({ ...base, amount: '12,50', date: '2026-12-01', currency: 'JPY', receiptAvailable: 'no', description: '' }, opts);
  assert.ok(bad.hints.amount && bad.hints.date && bad.hints.currency);
  assert.deepEqual(bad.missing, ['description']);
  assert.equal(fieldHints({ ...base, amount: '1,200.50' }, opts).hints.amount, undefined);
  assert.ok(fieldHints({ ...base, amount: '30', receiptAvailable: 'no' }, opts).hints.receiptAvailable);
});
