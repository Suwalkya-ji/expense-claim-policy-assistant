import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const POLICY_DIR = process.env.POLICY_DIR || path.resolve(here, '../../policy');

const STOPWORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the to was were will with must may not any per all this these those than be been their our your only up'.split(' '),
);

export function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Parse the policy markdown into addressable sections.
 * Each "## heading" followed by an "<!-- id: XYZ -->" marker becomes a section.
 */
function parsePolicy(markdown) {
  const sections = [];
  const blocks = markdown.split(/^## /m).slice(1);
  for (const block of blocks) {
    const [headingLine, ...rest] = block.split('\n');
    const body = rest.join('\n');
    const idMatch = body.match(/<!--\s*id:\s*([A-Z0-9-]+)\s*-->/);
    if (!idMatch) continue;
    const text = body.replace(idMatch[0], '').trim();
    sections.push({ id: idMatch[1], heading: headingLine.trim(), text, tokens: tokenize(`${headingLine} ${text}`) });
  }
  return sections;
}

function loadPolicy() {
  // Strip a UTF-8 BOM, which some Windows editors add on save.
  const read = (name) => fs.readFileSync(path.join(POLICY_DIR, name), 'utf8').replace(/^\uFEFF/, '');
  const markdown = read('expense-policy.md');
  const config = JSON.parse(read('policy-config.json'));
  const title = (markdown.match(/^# (.+)$/m) || [])[1] || 'Expense Policy';
  return { title, sections: parsePolicy(markdown), config };
}

const policy = loadPolicy();

export const getPolicy = () => policy;
export const getConfig = () => policy.config;
export const getSection = (id) => policy.sections.find((s) => s.id === id);
export const categoryKeys = () => Object.keys(policy.config.categories);

// Inverse document frequency over the policy sections, used for lexical ranking.
const idf = (() => {
  const df = new Map();
  for (const s of policy.sections) for (const t of new Set(s.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const n = policy.sections.length;
  const out = new Map();
  for (const [t, d] of df) out.set(t, Math.log(1 + n / d));
  return out;
})();

/** Rank policy sections by lexical overlap with a free-text query. */
export function searchSections(query, limit = 3) {
  const q = tokenize(query);
  if (!q.length) return [];
  return policy.sections
    .map((s) => {
      const tf = new Map();
      for (const t of s.tokens) tf.set(t, (tf.get(t) || 0) + 1);
      let score = 0;
      for (const t of new Set(q)) if (tf.has(t)) score += (idf.get(t) || 0) * (1 + Math.log(tf.get(t)));
      return { section: s, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Deterministic finding codes → the policy section that governs them.
const CODE_SECTIONS = {
  MISSING_FIELD: 'SUB-1',
  INVALID_AMOUNT: 'SUB-1',
  INVALID_DATE: 'SUB-2',
  FUTURE_DATE: 'SUB-2',
  STALE_DATE: 'SUB-2',
  DUPLICATE: 'SUB-3',
  MISSING_RECEIPT: 'REC-1',
  UNSUPPORTED_CURRENCY: 'FX-1',
  UNKNOWN_CATEGORY: 'SUB-1',
};

export const sectionForCode = (code, category) =>
  code === 'OVER_LIMIT' || code === 'OVER_DAILY_LIMIT'
    ? policy.config.categories[category]?.policySection
    : CODE_SECTIONS[code];

/**
 * Retrieve the policy sections relevant to a claim: the section for its
 * category (and any candidate categories), sections governing each
 * deterministic finding, plus top lexical matches on the description.
 */
export function retrieveForClaim(claim, { categories = [], findings = [] } = {}) {
  const picked = new Map();
  const add = (id, reason) => {
    const s = getSection(id);
    if (s && !picked.has(id)) picked.set(id, { id: s.id, heading: s.heading, text: s.text, reason });
  };
  for (const c of categories) {
    const sec = policy.config.categories[c]?.policySection;
    if (sec) add(sec, `category: ${c}`);
  }
  for (const f of findings) {
    const sec = f.sectionId || sectionForCode(f.code, f.category || categories[0]);
    if (sec) add(sec, `check: ${f.code}`);
  }
  for (const { section } of searchSections(`${claim.description || ''} ${claim.category || ''}`, 3)) {
    add(section.id, 'description match');
  }
  add('NONR-1', 'always checked');
  return [...picked.values()];
}
