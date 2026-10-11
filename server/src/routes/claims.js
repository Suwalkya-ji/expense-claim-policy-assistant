import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import mongoose from 'mongoose';
import { Claim } from '../models/Claim.js';
import { reviewClaim } from '../services/review.js';
import { computeTotals } from '../services/validation.js';
import { allCategoryKeys } from '../services/classifier.js';
import { getPolicy } from '../services/policy.js';
import { activeModel, PROVIDER, llmAvailable } from '../services/llm.js';
import { missingKeyReason } from '../env.js';
import { log } from '../logger.js';

export const router = Router();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CLAIM_FIELDS = ['claimant', 'date', 'category', 'amount', 'currency', 'description', 'receiptAvailable'];

/** Light normalisation of user input. Anything we can't interpret is kept as-is for validation to flag. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/; // 1,200.50 — but not 12,50

function normalizeClaimInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Each claim must be a JSON object.');
  const out = {};
  for (const f of CLAIM_FIELDS) {
    let v = raw[f] ?? raw[f === 'receiptAvailable' ? 'receipt' : f];
    if (v !== null && v !== undefined && typeof v === 'object') throw new HttpError(400, `Field "${f}" must be a string, number or boolean.`);
    if (f !== 'amount' && f !== 'receiptAvailable' && (typeof v === 'number' || typeof v === 'boolean')) v = String(v);
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    // Unparseable amounts (e.g. a decimal comma "12,50") stay strings so validation flags them.
    if (f === 'amount' && typeof v === 'string' && (PLAIN_NUMBER.test(v) || THOUSANDS.test(v))) v = Number(v.replace(/,/g, ''));
    if (f === 'currency' && typeof v === 'string') v = v.toUpperCase();
    if (f === 'receiptAvailable' && typeof v === 'string') {
      const s = v.toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(s)) v = true;
      else if (['no', 'n', 'false', '0'].includes(s)) v = false;
    }
    out[f] = v;
  }
  if (Object.values(out).every((v) => v === null)) throw new HttpError(400, 'The claim has no fields filled in.');
  return out;
}

const FINAL = new Set(['approved', 'rejected']);

const reviewerOf = (req) => String(req.body?.reviewer || req.get('x-reviewer') || 'reviewer').slice(0, 80);

async function findClaim(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Claim not found');
  const claim = await Claim.findById(id);
  if (!claim) throw new HttpError(404, 'Claim not found');
  return claim;
}

/** Run the review pipeline and record the result on the claim (not saved). */
async function runReview(claim, actor = 'system') {
  const others = await Claim.find({ _id: { $ne: claim._id } }, 'claimant date category amount currency status effectiveCategory amountUSD').lean();
  const review = await reviewClaim(claim.toObject(), { others });
  claim.review = review;
  claim.reviews.push(review);
  claim.effectiveCategory = review.effectiveCategory;
  claim.amountUSD = review.amountUSD;
  claim.history.push({
    type: 'ai_review',
    actor,
    details: {
      engine: review.engine,
      recommendation: review.recommendation,
      suggestedCategory: review.classification.suggested,
      confidence: review.classification.confidence,
      uncertain: review.classification.uncertain,
      findings: review.validation.length,
      error: review.error,
    },
  });
  log.info('review.completed', {
    claimId: String(claim._id),
    actor,
    engine: review.engine,
    classificationEngine: review.classification.engine,
    category: review.effectiveCategory,
    categorySource: review.categorySource,
    confidence: review.classification.confidence,
    uncertain: review.classification.uncertain,
    aiRecommendation: review.aiRecommendation,
    recommendation: review.recommendation,
    checks: review.validation.map((f) => f.code),
    unverifiedCitations: review.findings.filter((f) => f.uncited).length,
    aiCalls: review.aiCalls.length,
    error: review.error,
  });
  return claim;
}

const summaryView = (c) => ({
  _id: c._id,
  claimant: c.claimant,
  date: c.date,
  category: c.category,
  amount: c.amount,
  currency: c.currency,
  description: c.description,
  receiptAvailable: c.receiptAvailable,
  status: c.status,
  effectiveCategory: c.effectiveCategory,
  amountUSD: c.amountUSD,
  recommendation: c.review?.recommendation ?? null,
  uncertain: c.review?.classification?.uncertain ?? false,
  issueCount: (c.review?.validation || []).filter((f) => f.severity !== 'info').length,
  overridden: Boolean(c.categoryOverride?.category),
  updatedAt: c.updatedAt,
});

router.get('/meta', (_req, res) => {
  const { title, sections, config } = getPolicy();
  res.json({
    policy: { title, sections: sections.map(({ id, heading, text }) => ({ id, heading, text })) },
    categories: Object.fromEntries(Object.entries(config.categories).map(([k, c]) => [k, { label: c.label, limitUSD: c.limitUSD, dailyLimitUSD: c.dailyLimitUSD, policySection: c.policySection }])),
    categoryKeys: allCategoryKeys(),
    currencies: Object.keys(config.fxRatesToUSD),
    receiptThresholdUSD: config.receiptThresholdUSD,
    ai: {
      enabled: llmAvailable(),
      provider: llmAvailable() ? PROVIDER : null,
      model: llmAvailable() ? activeModel() : null,
      // Why AI is off, without exposing server file paths.
      offReason: llmAvailable() ? null : process.env.AI_DISABLED === 'true' ? 'AI_DISABLED=true is set on the server.' : missingKeyReason()?.replace(/\S*[\\/]server[\\/]/g, 'server/'),
    },
  });
});

const SAMPLES_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/sample-claims.json');

/** Sample claims with dates relative to today, for demos. */
router.get('/samples', (_req, res) => {
  const samples = JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf8'));
  res.json(samples.map(({ daysAgo, ...c }) => ({ ...c, date: new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10) })));
});

router.get('/claims', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  const claims = await Claim.find(filter).sort({ createdAt: -1 }).lean();
  res.json(claims.map(summaryView));
});

router.get('/summary', async (_req, res) => {
  const claims = await Claim.find({}, 'claimant amountUSD effectiveCategory status').lean();
  res.json({ all: computeTotals(claims), excludingRejected: computeTotals(claims.filter((c) => c.status !== 'rejected')) });
});

router.get('/claims/:id', async (req, res) => {
  res.json(await findClaim(req.params.id));
});

/** Submit one claim, an array of claims, or { claims: [...] }. */
router.post('/claims', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Send a claim, an array of claims, or { claims: [...] } as JSON.');
  const inputs = Array.isArray(body) ? body : Array.isArray(body.claims) ? body.claims : [body];
  if (!inputs.length || inputs.length > 200) throw new HttpError(400, 'Submit between 1 and 200 claims.');
  const normalized = inputs.map((i, n) => {
    try {
      return normalizeClaimInput(i);
    } catch (err) {
      throw inputs.length > 1 ? new HttpError(err.status || 400, `Claim ${n + 1}: ${err.message}`) : err;
    }
  });

  const actor = String(req.get('x-reviewer') || 'submitter');
  // Insert everything first so duplicates within one batch see each other.
  const created = await Claim.insertMany(normalized.map((c, n) => ({ ...c, history: [{ type: 'submitted', actor, details: { raw: inputs[n] } }] })));
  const reviewed = [];
  for (const doc of created) {
    const claim = await Claim.findById(doc._id);
    await runReview(claim);
    await claim.save();
    reviewed.push(claim);
  }
  log.info('claims.submitted', { count: reviewed.length, claimIds: reviewed.map((c) => String(c._id)) });
  res.status(201).json(Array.isArray(body) || Array.isArray(body?.claims) ? reviewed : reviewed[0]);
});

const fullyAI = (review) => Boolean(review && review.engine !== 'heuristic' && review.classification?.engine !== 'heuristic');

/**
 * Re-run the review on open claims (e.g. after fixing the Gemini key or model).
 * By default only claims whose last review did not fully use AI, to save API quota; ?all=true re-runs every open claim.
 */
router.post('/claims/review-open', async (req, res) => {
  const actor = reviewerOf(req);
  const all = req.query.all === 'true';
  const open = await Claim.find({ status: { $in: ['pending_review', 'needs_clarification'] } }, '_id review.engine review.classification.engine').sort({ createdAt: 1 }).lean();
  const todo = all ? open : open.filter((c) => !fullyAI(c.review));
  let aiReviewed = 0;
  for (const { _id } of todo) {
    const claim = await Claim.findById(_id);
    await runReview(claim, actor);
    await claim.save();
    if (fullyAI(claim.review)) aiReviewed += 1;
  }
  res.json({ open: open.length, reviewed: todo.length, aiReviewed, skipped: open.length - todo.length });
});

router.post('/claims/:id/review', async (req, res) => {
  const claim = await findClaim(req.params.id);
  if (FINAL.has(claim.status)) throw new HttpError(409, `Claim is already ${claim.status}; its review is kept as it was when decided.`);
  await runReview(claim, reviewerOf(req));
  await claim.save();
  res.json(claim);
});


/** Reviewer decision: approve | reject | request_clarification. */
router.post('/claims/:id/decision', async (req, res) => {
  const claim = await findClaim(req.params.id);
  const { action } = req.body || {};
  const note = String(req.body?.note || '').trim();
  const reviewer = reviewerOf(req);
  if (FINAL.has(claim.status)) throw new HttpError(409, `Claim is already ${claim.status}.`);

  if (action === 'approve') {
    const blocking = (claim.review?.validation || []).filter((f) => f.severity === 'error');
    if (blocking.length && !note) {
      throw new HttpError(422, `This claim has ${blocking.length} failed check(s); a note explaining the approval is required.`);
    }
    claim.status = 'approved';
  } else if (action === 'reject') {
    if (!note) throw new HttpError(422, 'A reason is required to reject a claim.');
    claim.status = 'rejected';
  } else if (action === 'request_clarification') {
    if (claim.status === 'needs_clarification') throw new HttpError(409, 'A clarification request is already open for this claim.');
    const questions = (Array.isArray(req.body?.questions) ? req.body.questions : []).map((q) => String(q).trim()).filter(Boolean);
    if (!note && !questions.length) throw new HttpError(422, 'Provide a message or at least one question for the claimant.');
    claim.status = 'needs_clarification';
    claim.clarifications.push({ message: note, questions, requestedBy: reviewer });
  } else {
    throw new HttpError(400, 'action must be one of approve, reject, request_clarification');
  }

  claim.history.push({
    type: 'decision',
    actor: reviewer,
    action,
    note,
    details: { aiRecommendation: claim.review?.recommendation ?? null, effectiveCategory: claim.effectiveCategory, questions: req.body?.questions },
  });
  await claim.save();
  // Human decision vs. the system's advice — the key signal for auditing the AI workflow.
  log.info('claim.decision', {
    claimId: String(claim._id),
    reviewer,
    action,
    status: claim.status,
    aiRecommendation: claim.review?.recommendation ?? null,
    reviewEngine: claim.review?.engine ?? null,
    failedChecks: (claim.review?.validation || []).filter((f) => f.severity === 'error').map((f) => f.code),
  });
  res.json(claim);
});

/** Override the AI / claimant category with a documented reason; re-runs the checks under the new category. */
router.post('/claims/:id/override', async (req, res) => {
  const claim = await findClaim(req.params.id);
  const category = String(req.body?.category || '');
  const reason = String(req.body?.reason || '').trim();
  const reviewer = reviewerOf(req);
  if (FINAL.has(claim.status)) throw new HttpError(409, `Claim is already ${claim.status}.`);
  if (!allCategoryKeys().includes(category) || category === 'unknown') throw new HttpError(400, `Unknown category "${category}".`);
  if (reason.length < 5) throw new HttpError(422, 'A reason (at least 5 characters) is required to override the classification.');

  const previous = { effectiveCategory: claim.effectiveCategory, suggested: claim.review?.classification?.suggested ?? null, confidence: claim.review?.classification?.confidence ?? null };
  claim.categoryOverride = { category, reason, by: reviewer, at: new Date() };
  claim.history.push({ type: 'override', actor: reviewer, note: reason, details: { from: previous, to: category } });
  log.info('claim.override', { claimId: String(claim._id), reviewer, from: previous.effectiveCategory, aiSuggested: previous.suggested, to: category });
  await runReview(claim, reviewer);
  await claim.save();
  res.json(claim);
});

/** Claimant answers a clarification request, optionally correcting fields; the claim is re-reviewed. */
router.post('/claims/:id/clarification-response', async (req, res) => {
  const claim = await findClaim(req.params.id);
  if (claim.status !== 'needs_clarification') throw new HttpError(409, 'No clarification is pending for this claim.');
  const response = String(req.body?.response || '').trim();
  if (!response) throw new HttpError(422, 'A response is required.');
  const by = String(req.body?.by || claim.claimant || 'claimant');

  const updates = normalizeClaimInput({ ...claim.toObject(), ...req.body?.updates });
  const changed = {};
  for (const [k, v] of Object.entries(updates)) {
    if (JSON.stringify(claim[k] ?? null) !== JSON.stringify(v)) {
      changed[k] = { from: claim[k] ?? null, to: v };
      claim[k] = v;
    }
  }
  const open = [...claim.clarifications].reverse().find((c) => !c.response);
  if (open) Object.assign(open, { response, respondedBy: by, respondedAt: new Date() });
  claim.status = 'pending_review';
  claim.history.push({ type: 'clarification_response', actor: by, note: response, details: { changed } });
  log.info('claim.clarification_response', { claimId: String(claim._id), by, changedFields: Object.keys(changed) });
  await runReview(claim);
  await claim.save();
  res.json(claim);
});

export function errorHandler(err, req, res, _next) {
  const badInput = err.type === 'entity.parse.failed' || err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError;
  const status = err.status || (badInput ? 400 : 500);
  if (status >= 500) log.error('http.error', { requestId: req.id, method: req.method, path: req.originalUrl, err });
  else log.debug('http.rejected', { requestId: req.id, status, message: err.message });
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
}

