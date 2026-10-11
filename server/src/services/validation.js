import { getConfig, sectionForCode } from './policy.js';

const REQUIRED_FIELDS = ['claimant', 'date', 'category', 'amount', 'currency', 'description', 'receiptAvailable'];
const DAY_MS = 24 * 60 * 60 * 1000;

const norm = (s) => String(s ?? '').trim().toLowerCase();
const round2 = (n) => Math.round(n * 100) / 100;

/** Parse a strict YYYY-MM-DD date; returns a UTC Date or null. */
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

export function toUSD(amount, currency) {
  const rate = getConfig().fxRatesToUSD[String(currency || '').toUpperCase()];
  return rate && Number.isFinite(amount) ? round2(amount * rate) : null;
}

/**
 * Map a submitted category string onto a configured policy category key.
 * Returns null when it doesn't match exactly — e.g. "Travel" could be airfare,
 * ground transport or lodging, so that's left for classification.
 */
export function resolveCategory(input) {
  const v = norm(input).replace(/[\s&–-]+/g, '_');
  if (!v) return null;
  const cats = getConfig().categories;
  for (const [key, c] of Object.entries(cats)) {
    if (v === key || v === norm(c.label).replace(/[\s&–-]+/g, '_')) return key;
  }
  const aliases = {
    meal: 'meals', food: 'meals', hotel: 'lodging', accommodation: 'lodging', flight: 'airfare', airfare: 'airfare',
    taxi: 'ground_transport', transport: 'ground_transport', office: 'office_supplies', supplies: 'office_supplies',
    equipment: 'office_supplies', subscription: 'software', subscriptions: 'software', gift: 'client_gifts',
    gifts: 'client_gifts', phone: 'telecom', internet: 'telecom', training: 'training', education: 'training',
  };
  return aliases[v] || null;
}

const finding = (code, severity, message, extra = {}) => ({ code, severity, message, sectionId: sectionForCode(code, extra.category) || null, ...extra });

const sameClaimant = (a, b) => norm(a.claimant) === norm(b.claimant);

/**
 * Deterministic, rule-based checks. Pure: everything it needs is passed in.
 *
 * @param claim          the claim being checked
 * @param opts.category  effective policy category key (after override / classification)
 * @param opts.others    other claims in the system (for duplicate + daily aggregate checks)
 * @param opts.now       reference "today" (injectable for tests)
 */
export function validateClaim(claim, { category = null, others = [], now = new Date() } = {}) {
  const cfg = getConfig();
  const findings = [];

  for (const f of REQUIRED_FIELDS) {
    const v = claim[f];
    const missing = f === 'receiptAvailable' ? typeof v !== 'boolean' : v === undefined || v === null || String(v).trim() === '';
    if (missing) findings.push(finding('MISSING_FIELD', 'error', `Required field "${f}" is missing.`, { field: f }));
  }

  // Only real numbers count: Number() would turn true, "0x20" or [30] into amounts.
  const amount = typeof claim.amount === 'number' ? claim.amount : NaN;
  const validAmount = Number.isFinite(amount) && amount > 0;
  if (claim.amount !== undefined && claim.amount !== null && claim.amount !== '' && !validAmount) {
    const commaHint = typeof claim.amount === 'string' && /^\d+,\d{1,2}$/.test(claim.amount.trim()) ? ' Use a dot for decimals (e.g. 12.50).' : '';
    findings.push(finding('INVALID_AMOUNT', 'error', `Amount "${claim.amount}" must be a positive number.${commaHint}`, { field: 'amount' }));
  }

  const currency = String(claim.currency || '').toUpperCase();
  if (currency && !cfg.fxRatesToUSD[currency]) {
    findings.push(finding('UNSUPPORTED_CURRENCY', 'error', `Currency "${claim.currency}" is not supported (allowed: ${Object.keys(cfg.fxRatesToUSD).join(', ')}).`, { field: 'currency' }));
  }

  const date = parseDate(claim.date);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (claim.date && !date) {
    findings.push(finding('INVALID_DATE', 'error', `Date "${claim.date}" is not a valid YYYY-MM-DD date.`, { field: 'date' }));
  } else if (date) {
    const ageDays = Math.round((today - date) / DAY_MS);
    // One day of tolerance: "today" is computed in UTC, and the claimant may be ahead of UTC.
    if (ageDays < -1) findings.push(finding('FUTURE_DATE', 'error', `Expense date ${claim.date} is in the future.`, { field: 'date' }));
    else if (ageDays > cfg.submissionWindowDays) {
      findings.push(finding('STALE_DATE', 'warning', `Expense is ${ageDays} days old, beyond the ${cfg.submissionWindowDays}-day submission window.`, { field: 'date' }));
    }
  }

  const amountUSD = validAmount ? toUSD(amount, currency) : null;

  if (amountUSD !== null && amountUSD >= cfg.receiptThresholdUSD && claim.receiptAvailable === false) {
    findings.push(finding('MISSING_RECEIPT', 'error', `No receipt for an expense of USD ${amountUSD.toFixed(2)} (receipts required from USD ${cfg.receiptThresholdUSD}).`, { field: 'receiptAvailable' }));
  }

  const cat = category ? cfg.categories[category] : null;
  if (claim.category && !category) {
    findings.push(finding('UNKNOWN_CATEGORY', 'warning', `Category "${claim.category}" does not map to a single policy category; classification needed.`, { field: 'category' }));
  }
  if (cat && amountUSD !== null && amountUSD > cat.limitUSD) {
    findings.push(finding('OVER_LIMIT', 'error', `USD ${amountUSD.toFixed(2)} exceeds the ${cat.label} limit of USD ${cat.limitUSD} per claim.`, { category, field: 'amount' }));
  }

  // Policy exclusions: phrases in the description that the policy explicitly rules out
  // (e.g. commuting, minibar, gift cards). A warning, since keyword matches need a human look.
  for (const ex of matchExclusions(claim.description, category)) {
    findings.push(
      finding('POLICY_EXCLUSION', 'warning', `The description mentions "${ex.keyword}". Policy ${ex.sectionId}: "${ex.quote}"`, {
        sectionId: ex.sectionId,
        quote: ex.quote,
        field: 'description',
      }),
    );
  }

  // Duplicate detection against other claims (rejected claims are ignored).
  const live = others.filter((o) => String(o._id) !== String(claim._id) && o.status !== 'rejected');
  if (claim.claimant && date && validAmount) {
    const exact = live.filter((o) => sameClaimant(o, claim) && o.date === claim.date && Number(o.amount) === amount && String(o.currency).toUpperCase() === currency);
    if (exact.length) {
      findings.push(finding('DUPLICATE', 'error', `Duplicate of ${exact.length} other claim(s) with the same claimant, date, amount and currency.`, { relatedClaimIds: exact.map((o) => String(o._id)) }));
    } else {
      const near = live.filter((o) => {
        const od = parseDate(o.date);
        return sameClaimant(o, claim) && od && Math.abs(od - date) <= 3 * DAY_MS && Number(o.amount) === amount && String(o.currency).toUpperCase() === currency;
      });
      if (near.length) {
        findings.push(finding('DUPLICATE', 'warning', `Possible duplicate: same claimant and amount within 3 days of ${near.length} other claim(s).`, { relatedClaimIds: near.map((o) => String(o._id)) }));
      }
    }
  }

  // Daily meals aggregate for the claimant (advisory: client meals have a higher per-attendee cap).
  if (category === 'meals' && cat?.dailyLimitUSD && claim.claimant && date && amountUSD !== null) {
    // Claims from the same batch may not be reviewed yet, so fall back to their submitted category and amount.
    const catOf = (o) => o.effectiveCategory ?? resolveCategory(o.category);
    const usdOf = (o) => (typeof o.amountUSD === 'number' ? o.amountUSD : typeof o.amount === 'number' && o.amount > 0 ? toUSD(o.amount, o.currency) : null);
    const sameDay = live.filter((o) => sameClaimant(o, claim) && o.date === claim.date && catOf(o) === 'meals');
    const dayTotal = round2(amountUSD + sameDay.reduce((s, o) => s + (usdOf(o) || 0), 0));
    if (dayTotal > cat.dailyLimitUSD) {
      findings.push(finding('OVER_DAILY_LIMIT', 'warning', `Meals on ${claim.date} total USD ${dayTotal.toFixed(2)}, above the USD ${cat.dailyLimitUSD}/day individual limit (client entertainment allows up to USD 150 per attendee).`, { category, field: 'amount' }));
    }
  }

  return { findings, amountUSD };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Exclusion rules (from policy-config.json) whose keywords appear in the description,
 * for the claim's category plus the general non-reimbursable list. One match per rule.
 */
export function matchExclusions(description, category) {
  const text = String(description || '').toLowerCase();
  if (!text) return [];
  const cfg = getConfig();
  const rules = [
    ...((category && cfg.categories[category]?.exclusions) || []).map((r) => ({ ...r, sectionId: cfg.categories[category].policySection })),
    ...(cfg.generalExclusions ? [{ ...cfg.generalExclusions, sectionId: cfg.generalExclusions.policySection }] : []),
  ];
  const out = [];
  for (const rule of rules) {
    const keyword = rule.keywords.find((k) => new RegExp(`(^|[^a-z])${escapeRe(k.toLowerCase())}($|[^a-z])`).test(text));
    if (keyword) out.push({ keyword, quote: rule.quote, sectionId: rule.sectionId });
  }
  return out;
}

/** Totals in base currency, grouped by claimant, category and status. */
export function computeTotals(claims) {
  const totals = { currency: getConfig().baseCurrency, count: claims.length, totalUSD: 0, byClaimant: {}, byCategory: {}, byStatus: {}, unconvertible: 0 };
  for (const c of claims) {
    if (typeof c.amountUSD !== 'number') {
      totals.unconvertible += 1;
      continue;
    }
    totals.totalUSD += c.amountUSD;
    const bump = (bucket, key) => {
      bucket[key] ??= { count: 0, totalUSD: 0 };
      bucket[key].count += 1;
      bucket[key].totalUSD = round2(bucket[key].totalUSD + c.amountUSD);
    };
    bump(totals.byClaimant, c.claimant || '(unknown)');
    bump(totals.byCategory, c.effectiveCategory || 'unclassified');
    bump(totals.byStatus, c.status || 'pending');
  }
  totals.totalUSD = round2(totals.totalUSD);
  return totals;
}
