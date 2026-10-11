import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPolicy, getConfig, retrieveForClaim, searchSections } from '../src/services/policy.js';

test('every configured category points at a real policy section', () => {
  const ids = new Set(getPolicy().sections.map((s) => s.id));
  assert.ok(ids.size >= 15);
  for (const [key, c] of Object.entries(getConfig().categories)) assert.ok(ids.has(c.policySection), key);
});

test('lexical search finds the right section', () => {
  assert.equal(searchSections('uber taxi from airport')[0].section.id, 'TRAV-2');
  assert.equal(searchSections('hotel room per night')[0].section.id, 'LODG-1');
});

test('retrieval includes category, finding and always-on sections', () => {
  const secs = retrieveForClaim({ description: 'conference registration' }, { categories: ['training'], findings: [{ code: 'MISSING_RECEIPT' }] });
  const ids = secs.map((s) => s.id);
  assert.ok(ids.includes('TRN-1'));
  assert.ok(ids.includes('REC-1'));
  assert.ok(ids.includes('NONR-1'));
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
});

test('every exclusion rule quotes the policy word for word', () => {
  const { sections, config } = getPolicy();
  const textOf = (id) => sections.find((s) => s.id === id)?.text.replace(/\s+/g, ' ') || '';
  const rules = [
    ...Object.values(config.categories).flatMap((c) => (c.exclusions || []).map((r) => ({ ...r, sectionId: c.policySection }))),
    { ...config.generalExclusions, sectionId: config.generalExclusions.policySection },
  ];
  assert.ok(rules.length >= 8);
  for (const r of rules) assert.ok(textOf(r.sectionId).includes(r.quote), `${r.sectionId}: "${r.quote}"`);
});
