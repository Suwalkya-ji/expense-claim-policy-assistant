import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClaim, computeTotals, resolveCategory, parseDate, toUSD, matchExclusions } from '../src/services/validation.js';

const NOW = new Date('2026-10-10T12:00:00Z');
const base = { _id: 'a', claimant: 'Ana', date: '2026-10-01', category: 'Meals', amount: 40, currency: 'USD', description: 'Travel dinner', receiptAvailable: true };
const codes = (r) => r.findings.map((f) => `${f.code}:${f.severity}`);

test('a clean claim has no findings', () => {
  const r = validateClaim(base, { category: 'meals', now: NOW });
  assert.deepEqual(r.findings, []);
  assert.equal(r.amountUSD, 40);
});

test('missing required fields are reported individually', () => {
  const r = validateClaim({ claimant: 'Ana', amount: 10, currency: 'USD' }, { now: NOW });
  const missing = r.findings.filter((f) => f.code === 'MISSING_FIELD').map((f) => f.field);
  assert.deepEqual(missing.sort(), ['category', 'date', 'description', 'receiptAvailable']);
  assert.ok(r.findings.every((f) => f.sectionId === 'SUB-1'));
});

test('date validation: malformed, impossible, future, stale', () => {
  assert.ok(codes(validateClaim({ ...base, date: '01/10/2026' }, { now: NOW })).includes('INVALID_DATE:error'));
  assert.ok(codes(validateClaim({ ...base, date: '2026-02-30' }, { now: NOW })).includes('INVALID_DATE:error'));
  assert.ok(codes(validateClaim({ ...base, date: '2026-10-12' }, { now: NOW })).includes('FUTURE_DATE:error'));
  assert.ok(!codes(validateClaim({ ...base, date: '2026-10-11' }, { now: NOW })).includes('FUTURE_DATE:error'), 'one day of timezone tolerance');
  assert.ok(codes(validateClaim({ ...base, date: '2026-06-01' }, { now: NOW })).includes('STALE_DATE:warning'));
  assert.equal(parseDate('2024-02-29').toISOString().slice(0, 10), '2024-02-29');
});

test('amount and currency validation', () => {
  assert.ok(codes(validateClaim({ ...base, amount: -5 }, { now: NOW })).includes('INVALID_AMOUNT:error'));
  assert.ok(codes(validateClaim({ ...base, amount: 'abc' }, { now: NOW })).includes('INVALID_AMOUNT:error'));
  for (const bad of [true, '0x20', [30], '30', 0]) {
    assert.ok(codes(validateClaim({ ...base, amount: bad }, { now: NOW })).includes('INVALID_AMOUNT:error'), `amount ${JSON.stringify(bad)} is invalid`);
  }
  assert.ok(codes(validateClaim({ ...base, currency: 'JPY' }, { now: NOW })).includes('UNSUPPORTED_CURRENCY:error'));
  assert.equal(toUSD(100, 'EUR'), 108);
});

test('receipt is required at or above the threshold only', () => {
  assert.ok(codes(validateClaim({ ...base, amount: 25, receiptAvailable: false }, { now: NOW })).includes('MISSING_RECEIPT:error'));
  assert.deepEqual(validateClaim({ ...base, amount: 24.99, receiptAvailable: false }, { category: 'meals', now: NOW }).findings, []);
  // 2000 INR = 24 USD → under threshold
  assert.deepEqual(validateClaim({ ...base, amount: 2000, currency: 'INR', receiptAvailable: false }, { category: 'meals', now: NOW }).findings, []);
});

test('category limits use converted USD amount', () => {
  const r = validateClaim({ ...base, amount: 140, currency: 'GBP' }, { category: 'meals', now: NOW });
  const f = r.findings.find((x) => x.code === 'OVER_LIMIT');
  assert.ok(f, 'GBP 140 = USD 177.80 > 150');
  assert.equal(f.sectionId, 'MEAL-1');
});

test('unmapped category is flagged for classification', () => {
  assert.ok(codes(validateClaim({ ...base, category: 'Travel' }, { now: NOW })).includes('UNKNOWN_CATEGORY:warning'));
  assert.equal(resolveCategory('Travel'), null);
  assert.equal(resolveCategory('Office Supplies'), 'office_supplies');
  assert.equal(resolveCategory('hotel'), 'lodging');
});

test('exact and near duplicates; rejected claims ignored', () => {
  const exact = { ...base, _id: 'b', claimant: ' ana ' };
  assert.ok(codes(validateClaim(base, { category: 'meals', others: [exact], now: NOW })).includes('DUPLICATE:error'));
  const near = { ...base, _id: 'c', date: '2026-10-03' };
  assert.ok(codes(validateClaim(base, { category: 'meals', others: [near], now: NOW })).includes('DUPLICATE:warning'));
  assert.ok(!codes(validateClaim(base, { category: 'meals', others: [{ ...exact, status: 'rejected' }], now: NOW })).some((c) => c.startsWith('DUPLICATE')));
  assert.ok(!codes(validateClaim(base, { category: 'meals', others: [{ ...base }], now: NOW })).some((c) => c.startsWith('DUPLICATE')), 'a claim is not its own duplicate');
});

test('daily meals aggregate warns above the per-day limit', () => {
  const other = { ...base, _id: 'z', amount: 50, amountUSD: 50, effectiveCategory: 'meals', description: 'Lunch' };
  assert.ok(codes(validateClaim(base, { category: 'meals', others: [other], now: NOW })).includes('OVER_DAILY_LIMIT:warning'));
});

test('totals are grouped and skip unconvertible claims', () => {
  const t = computeTotals([
    { claimant: 'Ana', amountUSD: 10, effectiveCategory: 'meals', status: 'approved' },
    { claimant: 'Ana', amountUSD: 5.555, effectiveCategory: 'software', status: 'pending_review' },
    { claimant: 'Bo', amountUSD: null, status: 'pending_review' },
  ]);
  assert.equal(t.totalUSD, 15.56);
  assert.equal(t.byClaimant.Ana.count, 2);
  assert.equal(t.unconvertible, 1);
  assert.equal(t.byCategory.meals.totalUSD, 10);
});

test('claims without an amount are not duplicates of each other', () => {
  const noAmount = { ...base, amount: null };
  assert.ok(!codes(validateClaim(noAmount, { others: [{ ...noAmount, _id: 'q' }], now: NOW })).some((c) => c.startsWith('DUPLICATE')));
});

test('daily meals limit counts same-batch claims that are not reviewed yet', () => {
  const unreviewed = { ...base, _id: 'u', amount: 50, description: 'Lunch' }; // no effectiveCategory / amountUSD yet
  const r = validateClaim({ ...base, amount: 40 }, { category: 'meals', others: [unreviewed], now: NOW });
  assert.ok(codes(r).includes('OVER_DAILY_LIMIT:warning'));
});

test('policy exclusions in the description are flagged with the policy quote', () => {
  const r = validateClaim({ ...base, category: 'Travel', amount: 20, description: 'Travel from office to home', receiptAvailable: false }, { category: 'ground_transport', now: NOW });
  const f = r.findings.find((x) => x.code === 'POLICY_EXCLUSION');
  assert.ok(f, 'commuting is excluded');
  assert.equal(f.severity, 'warning');
  assert.equal(f.sectionId, 'TRAV-2');
  assert.match(f.quote, /Commuting between home and the regular office/);

  assert.deepEqual(matchExclusions('Uber from airport to hotel', 'ground_transport'), [], 'normal business travel is fine');
  assert.equal(matchExclusions('Hotel minibar and room service', 'lodging')[0].sectionId, 'LODG-1');
  assert.equal(matchExclusions('Parking fine outside client office', 'meals')[0].sectionId, 'NONR-1', 'general exclusions apply to any category');
  assert.deepEqual(matchExclusions('Fine dining with client', 'meals'), [], 'whole phrases only');
  // Laptops/monitors are only excluded above the USD 200 limit, which OVER_LIMIT already checks.
  assert.deepEqual(matchExclusions('Wireless keyboard and mouse for work laptop', 'office_supplies'), []);
  assert.deepEqual(matchExclusions('USB-C cable and 27" monitor stand', 'office_supplies'), []);
});
