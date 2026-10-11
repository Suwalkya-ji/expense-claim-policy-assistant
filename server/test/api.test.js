// Integration test against a real MongoDB (MONGODB_TEST_URI, default local). Skips if unreachable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setLlmOverride } from '../src/services/llm.js';

const URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/expense_review_test';
let connected = false;
const app = createApp();
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  process.env.AI_DISABLED = 'true';
  setLlmOverride(null);
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
    await mongoose.connection.db.dropDatabase();
    connected = true;
  } catch {
    console.warn(`MongoDB not reachable at ${URI}; skipping API tests`);
  }
});
after(async () => {
  if (connected) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

const claim = { claimant: 'Ana', date: today, category: 'Meals', amount: '42.00', currency: 'usd', description: 'Dinner on Chicago trip', receiptAvailable: 'yes' };

test('submit → review → duplicate detection → decisions → history', async (t) => {
  if (!connected) return t.skip('no MongoDB');

  const created = await request(app).post('/api/claims').send({ claims: [claim, claim] }).expect(201);
  assert.equal(created.body.length, 2);
  const [a, b] = created.body;
  assert.equal(a.amount, 42);
  assert.equal(a.currency, 'USD');
  assert.equal(a.receiptAvailable, true);
  assert.ok(a.review.validation.some((f) => f.code === 'DUPLICATE'), 'batch duplicates see each other');
  assert.equal(a.review.recommendation, 'needs_review');

  // Approving with a failed check needs a note.
  await request(app).post(`/api/claims/${a._id}/decision`).send({ action: 'approve' }).expect(422);
  await request(app).post(`/api/claims/${b._id}/decision`).send({ action: 'reject', note: 'Duplicate of the other claim', reviewer: 'kim' }).expect(200);

  // Once b is rejected, re-reviewing a no longer reports a duplicate.
  const rerun = await request(app).post(`/api/claims/${a._id}/review`).expect(200);
  assert.ok(!rerun.body.review.validation.some((f) => f.code === 'DUPLICATE'));
  const approved = await request(app).post(`/api/claims/${a._id}/decision`).send({ action: 'approve', reviewer: 'kim' }).expect(200);
  assert.equal(approved.body.status, 'approved');
  await request(app).post(`/api/claims/${a._id}/decision`).send({ action: 'reject', note: 'x' }).expect(409);

  const full = await request(app).get(`/api/claims/${a._id}`).expect(200);
  assert.deepEqual(full.body.history.map((h) => h.type), ['submitted', 'ai_review', 'ai_review', 'decision']);
  assert.equal(full.body.reviews.length, 2);
});

test('clarification round trip and category override', async (t) => {
  if (!connected) return t.skip('no MongoDB');
  const { body: c } = await request(app).post('/api/claims').send({ ...claim, claimant: 'Bo', category: 'Other', description: 'misc', amount: 150, receiptAvailable: 'no' }).expect(201);
  assert.ok(c.review.questions.length >= 1);
  assert.equal(c.review.classification.uncertain, true);

  await request(app).post(`/api/claims/${c._id}/clarification-response`).send({ response: 'hi' }).expect(409);
  await request(app).post(`/api/claims/${c._id}/decision`).send({ action: 'request_clarification', questions: c.review.questions }).expect(200);
  const answered = await request(app)
    .post(`/api/claims/${c._id}/clarification-response`)
    .send({ response: 'It was a client lunch; receipt found.', updates: { receiptAvailable: true, category: 'Meals' } })
    .expect(200);
  assert.equal(answered.body.status, 'pending_review');
  assert.equal(answered.body.effectiveCategory, 'meals');
  assert.ok(!answered.body.review.validation.some((f) => f.code === 'MISSING_RECEIPT'));
  assert.ok(!answered.body.review.validation.some((f) => f.code === 'OVER_LIMIT'), 'USD 150 is within the meals limit');

  await request(app).post(`/api/claims/${c._id}/override`).send({ category: 'software' }).expect(422);
  await request(app).post(`/api/claims/${c._id}/override`).send({ category: 'nope', reason: 'whatever' }).expect(400);
  const over = await request(app).post(`/api/claims/${c._id}/override`).send({ category: 'software', reason: 'Actually a SaaS plan', reviewer: 'kim' }).expect(200);
  assert.equal(over.body.effectiveCategory, 'software');
  assert.equal(over.body.review.categorySource, 'override');
  assert.ok(over.body.review.validation.some((f) => f.code === 'OVER_LIMIT'), 'checks re-run under the overridden category (USD 150 > software limit 100)');
});

test('re-run open reviews refreshes pending claims only', async (t) => {
  if (!connected) return t.skip('no MongoDB');
  const { body } = await request(app).get('/api/claims').expect(200);
  const open = body.filter((c) => ['pending_review', 'needs_clarification'].includes(c.status)).length;
  const r = await request(app).post('/api/claims/review-open').expect(200);
  assert.equal(r.body.open, open);
  assert.equal(r.body.reviewed, open, 'no claim has a full AI review, so all are re-run');
  assert.equal(r.body.aiReviewed, 0);

  // Claims that already have a full AI review are skipped unless ?all=true.
  const { setLlmOverride } = await import('../src/services/llm.js');
  setLlmOverride(async ({ schema }) =>
    schema.properties.category
      ? { category: 'meals', confidence: 0.9, alternatives: [], rationale: 'r' }
      : { recommendation: 'comply', summary: 's', findings: [], questionsForClaimant: [] },
  );
  try {
    const first = await request(app).post('/api/claims/review-open').expect(200);
    assert.equal(first.body.aiReviewed, open);
    const second = await request(app).post('/api/claims/review-open').expect(200);
    assert.equal(second.body.reviewed, 0);
    assert.equal(second.body.skipped, open);
    const forced = await request(app).post('/api/claims/review-open?all=true').expect(200);
    assert.equal(forced.body.reviewed, open);
  } finally {
    setLlmOverride(null);
  }
});

test('bad input is rejected with 400, not 500', async (t) => {
  if (!connected) return t.skip('no MongoDB');
  await request(app).post('/api/claims').send([null]).expect(400);
  await request(app).post('/api/claims').send({ ...claim, claimant: { a: 1 } }).expect(400);
  await request(app).post('/api/claims').set('Content-Type', 'application/json').send('').expect(400);
  await request(app).post('/api/claims').set('Content-Type', 'application/json').send('{bad').expect(400);
  await request(app).get('/api/nope').expect(404).expect('Content-Type', /json/);

  const { body: comma } = await request(app).post('/api/claims').send({ ...claim, claimant: 'Eve', amount: '12,50', currency: 'EUR' }).expect(201);
  assert.equal(comma.amount, '12,50', 'decimal comma is not read as 1250');
  assert.ok(comma.review.validation.some((f) => f.code === 'INVALID_AMOUNT'));
  const { body: thousands } = await request(app).post('/api/claims').send({ ...claim, claimant: 'Eve', amount: '1,200.50' }).expect(201);
  assert.equal(thousands.amount, 1200.5);
});

test('final claims cannot be re-reviewed; clarification requests do not stack', async (t) => {
  if (!connected) return t.skip('no MongoDB');
  const { body: c } = await request(app).post('/api/claims').send({ ...claim, claimant: 'Finn', amount: 10 }).expect(201);
  await request(app).post(`/api/claims/${c._id}/decision`).send({ action: 'request_clarification', note: 'Who attended?' }).expect(200);
  await request(app).post(`/api/claims/${c._id}/decision`).send({ action: 'request_clarification', note: 'Again?' }).expect(409);
  await request(app).post(`/api/claims/${c._id}/decision`).send({ action: 'approve', note: 'ok' }).expect(200);
  await request(app).post(`/api/claims/${c._id}/review`).expect(409);
});

test('health reports database state', async (t) => {
  if (!connected) return t.skip('no MongoDB');
  const r = await request(app).get('/api/health').expect(200);
  assert.deepEqual(r.body, { ok: true, db: 'connected' });
  assert.ok(r.headers['x-request-id'], 'requests are tagged with an id');
});

test('summary and validation errors', async (t) => {
  if (!connected) return t.skip('no MongoDB');
  const s = await request(app).get('/api/summary').expect(200);
  assert.ok(s.body.all.totalUSD > 0);
  assert.ok(s.body.excludingRejected.totalUSD < s.body.all.totalUSD);
  await request(app).get('/api/claims/not-an-id').expect(404);
  await request(app).post('/api/claims/000000000000000000000000/decision').send({ action: 'approve' }).expect(404);
});

test('optional basic auth protects everything but the health check', async (t) => {
  if (!connected) return t.skip('no MongoDB');
  process.env.APP_USERNAME = 'reviewer';
  process.env.APP_PASSWORD = 's3cret';
  try {
    await request(app).get('/api/claims').expect(401).expect('www-authenticate', /Basic/);
    await request(app).get('/api/claims').auth('reviewer', 'wrong').expect(401);
    await request(app).get('/api/claims').auth('reviewer', 's3cret').expect(200);
    await request(app).get('/api/health').expect(200);
  } finally {
    delete process.env.APP_USERNAME;
    delete process.env.APP_PASSWORD;
  }
});
