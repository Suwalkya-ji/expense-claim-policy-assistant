import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setLlmOverride } from '../src/services/llm.js';
import { heuristicClassify } from '../src/services/classifier.js';
import { combineRecommendation, decideCategory, reviewClaim, verifyCitations } from '../src/services/review.js';

afterEach(() => setLlmOverride(null));
const NOW = new Date('2026-10-10T12:00:00Z');
const claim = { _id: 'x', claimant: 'Ana', date: '2026-10-05', category: 'Travel', amount: 30, currency: 'USD', description: 'Uber from airport to client office', receiptAvailable: true };

test('heuristic classifier: clear, ambiguous and personal descriptions', () => {
  assert.equal(heuristicClassify({ description: 'Uber taxi to the airport' }).category, 'ground_transport');
  assert.equal(heuristicClassify({ description: 'misc things' }).category, 'unknown');
  assert.equal(heuristicClassify({ description: 'Parking fine outside client office' }).category, 'non_reimbursable');
});

test('citations are verified against retrieved section text', () => {
  const retrieved = [{ id: 'REC-1', heading: '3. Receipts', text: 'An itemised receipt is required for any single expense of USD 25 or more.' }];
  const [ok, wrongQuote, notRetrieved] = verifyCitations(
    [
      { statement: 'a', citations: [{ sectionId: 'REC-1', quote: 'itemised receipt is required' }] },
      { statement: 'b', citations: [{ sectionId: 'REC-1', quote: 'receipts are optional' }] },
      { statement: 'c', citations: [{ sectionId: 'LODG-1', quote: 'Hotel accommodation' }] },
    ],
    retrieved,
  );
  assert.equal(ok.citations[0].verified, true);
  assert.equal(ok.uncited, false);
  assert.equal(wrongQuote.uncited, true);
  assert.equal(notRetrieved.citations[0].verified, false);
});

test('deterministic findings can only make the recommendation stricter', () => {
  assert.equal(combineRecommendation('comply', [], false), 'comply');
  assert.equal(combineRecommendation('comply', [{ code: 'MISSING_RECEIPT', severity: 'error' }], false), 'needs_clarification');
  assert.equal(combineRecommendation('comply', [{ code: 'DUPLICATE', severity: 'error' }], false), 'needs_review');
  assert.equal(combineRecommendation('needs_review', [{ code: 'MISSING_RECEIPT', severity: 'error' }], false), 'needs_review');
  assert.equal(combineRecommendation('comply', [], true), 'needs_review');
  assert.equal(combineRecommendation('bogus', [], false), 'needs_review');
});

test('category decision: override > claimant > classifier, with uncertainty', () => {
  const cls = { category: 'lodging', confidence: 0.9, engine: 'gemini', alternatives: [] };
  assert.equal(decideCategory({ category: 'Meals', categoryOverride: { category: 'software' } }, cls).source, 'override');
  const mismatch = decideCategory({ category: 'Meals' }, cls);
  assert.equal(mismatch.category, 'meals');
  assert.equal(mismatch.mismatch, true);
  const low = decideCategory({ category: 'Travel' }, { ...cls, confidence: 0.5 });
  assert.equal(low.category, 'lodging');
  assert.equal(low.uncertain, true);
});

test('full review with Gemini stubbed: classification, citations, combination', async () => {
  const calls = [];
  setLlmOverride(async ({ schema, prompt }) => {
    calls.push(prompt);
    if (schema.properties.category) return { category: 'ground_transport', confidence: 0.92, alternatives: ['airfare'], rationale: 'Mentions Uber and airport.' };
    return {
      recommendation: 'comply',
      summary: 'Ride-share for business travel within the limit.',
      findings: [
        { statement: 'Ride-share is reimbursable.', assessment: 'supports', citations: [{ sectionId: 'TRAV-2', quote: 'ride-share (e.g. Uber, Lyft)' }] },
        { statement: 'Invented rule.', assessment: 'concern', citations: [{ sectionId: 'TRAV-2', quote: 'Uber is banned on weekends' }] },
      ],
      questionsForClaimant: [],
    };
  });
  const r = await reviewClaim(claim, { now: NOW });
  assert.equal(r.engine, 'gemini');
  assert.equal(r.effectiveCategory, 'ground_transport');
  assert.equal(r.classification.uncertain, false);
  assert.equal(r.recommendation, 'comply', '"Travel" was classified confidently, so no category question is needed');
  assert.equal(r.categorySource, 'gemini');
  assert.equal(r.findings[0].uncited, false);
  assert.equal(r.findings[1].uncited, true, 'fabricated quote is not verified');
  assert.ok(r.retrievedSections.some((s) => s.id === 'TRAV-2'));
  assert.match(calls[1], /<section id="TRAV-2"/);
});

test('falls back to heuristics when Gemini errors', async () => {
  const { LlmError } = await import('../src/services/llm.js');
  setLlmOverride(async () => {
    throw new LlmError('boom');
  });
  const r = await reviewClaim({ ...claim, category: 'Ground Transport', amount: 140 }, { now: NOW });
  assert.equal(r.engine, 'heuristic');
  assert.equal(r.error, 'boom');
  assert.ok(r.validation.some((f) => f.code === 'OVER_LIMIT'));
  assert.equal(r.recommendation, 'needs_review');
});

test('a failed classification call does not trigger a second AI call', async () => {
  const { LlmError } = await import('../src/services/llm.js');
  let calls = 0;
  setLlmOverride(async () => {
    calls += 1;
    throw new LlmError('model not found');
  });
  const r = await reviewClaim(claim, { now: NOW });
  assert.equal(calls, 1);
  assert.equal(r.engine, 'heuristic');
  assert.equal(r.error, 'model not found');
});

test('heuristic does not claim "within limit" when the amount is invalid', async () => {
  const r = await reviewClaim({ ...claim, category: 'Meals', amount: 'abc' }, { now: NOW });
  assert.ok(!r.findings.some((f) => /within the/.test(f.statement)));
});

test('overriding to non-reimbursable always needs review', async () => {
  setLlmOverride(async ({ schema }) =>
    schema.properties.category
      ? { category: 'ground_transport', confidence: 0.9, alternatives: [], rationale: 'r' }
      : { recommendation: 'comply', summary: 's', findings: [], questionsForClaimant: [] },
  );
  const r = await reviewClaim({ ...claim, categoryOverride: { category: 'non_reimbursable', reason: 'personal' } }, { now: NOW });
  assert.ok(r.validation.some((f) => f.code === 'NON_REIMBURSABLE' && f.sectionId === 'NONR-1'));
  assert.equal(r.recommendation, 'needs_review');
});

test('each review records its AI calls (purpose, outcome, attempts)', async () => {
  const { LlmError } = await import('../src/services/llm.js');
  setLlmOverride(async ({ schema }) => {
    if (schema.properties.category) return { category: 'ground_transport', confidence: 0.9, alternatives: [], rationale: 'r' };
    throw new LlmError('quota');
  });
  const r = await reviewClaim(claim, { now: NOW });
  assert.deepEqual(r.aiCalls.map((c) => [c.purpose, c.ok]), [['classify', true], ['assess', false]]);
  assert.equal(r.aiCalls[1].error, 'quota');
  assert.ok(r.aiCalls.every((c) => typeof c.durationMs === 'number' && c.attempts === 1));
});

test('heuristic review of a commute claim needs review and cites TRAV-2 verbatim', async () => {
  const r = await reviewClaim({ ...claim, category: 'Travel – Ground Transport', amount: 20, description: 'Travel from office to home', receiptAvailable: false }, { now: NOW });
  assert.equal(r.engine, 'heuristic');
  assert.equal(r.recommendation, 'needs_review');
  const f = r.findings.find((x) => /office to home/.test(x.statement));
  assert.equal(f.citations[0].sectionId, 'TRAV-2');
  assert.equal(f.citations[0].verified, true);
});
