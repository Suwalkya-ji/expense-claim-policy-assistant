import { GoogleGenAI } from '@google/genai';
import { log } from '../logger.js';

// AI review runs on Google Gemini when GEMINI_API_KEY (or GOOGLE_API_KEY) is set.
// No key → heuristic fallback.
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export const PROVIDER = 'gemini';
export const activeModel = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

let gemini = null;
let override = null;

// Retries are handled below (they honour Gemini's "retry in Ns"), so the SDK's own are off.
const client = () => (gemini ??= new GoogleGenAI({ apiKey: apiKey(), httpOptions: { retryOptions: { attempts: 1 } } }));

const RETRYABLE = new Set([429, 500, 503, 504]);
const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 65_000; // longer waits (e.g. a daily quota) are not worth blocking a request for

let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tests replace the sleep so retries run instantly. */
export function setSleep(fn) {
  sleep = fn;
}

/** How long Gemini asked us to wait, from "Please retry in 10.1s" or a RetryInfo detail. */
export function retryDelayMs(err) {
  const text = String(err?.message || '');
  const m = text.match(/retry in ([\d.]+)\s*(ms|s)\b/i) || text.match(/"retryDelay"\s*:\s*"([\d.]+)(s)"/);
  if (!m) return null;
  return Math.ceil(Number(m[1]) * (m[2].toLowerCase() === 'ms' ? 1 : 1000));
}

// Optional client-side pacing: GEMINI_RPM=5 spaces calls 12 s apart (free tier).
let nextSlot = 0;
async function pace() {
  const rpm = Number(process.env.GEMINI_RPM) || 0;
  if (rpm <= 0) return;
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 60_000 / rpm;
  if (wait) await sleep(wait);
}

/** Run one Gemini request, retrying rate limits and temporary overloads. `meta.attempts` reports how many were made. */
async function withRetry(fn, meta, purpose) {
  for (let attempt = 1; ; attempt += 1) {
    meta.attempts = attempt;
    await pace();
    try {
      return await fn();
    } catch (err) {
      const retryable = RETRYABLE.has(err?.status) || (!err?.status && /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(err?.message)));
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
      const wait = retryDelayMs(err) ?? 2000 * 2 ** (attempt - 1);
      if (wait > MAX_WAIT_MS) {
        err.retryAfterMs = wait; // e.g. a daily quota: not worth waiting for
        throw err;
      }
      log.warn('ai.retry', { purpose, model: activeModel(), attempt, status: err?.status ?? null, waitMs: wait });
      await sleep(wait + 250);
    }
  }
}

/** Tests (and offline demos) can swap in a fake: fn({ system, prompt, schema }) => object */
export function setLlmOverride(fn) {
  override = fn;
}

export function llmAvailable() {
  if (override) return true;
  if (process.env.AI_DISABLED === 'true') return false;
  return Boolean(apiKey());
}

export class LlmError extends Error {}

/** Gemini API errors carry the raw JSON body as the message; turn it into a readable sentence. */
export function describeGeminiError(err) {
  let message = err?.message || String(err);
  try {
    message = JSON.parse(message).error?.message || message;
  } catch {
    // not JSON — keep as is
  }
  const status = err?.status;
  if (status === 404) return `Gemini model "${activeModel()}" is not available to this API key (${message}) Set GEMINI_MODEL in server/.env to a model your key can use.`;
  if (status === 400 && /api key/i.test(message)) return `Gemini rejected the API key (${message}) Check GEMINI_API_KEY in server/.env.`;
  if (status === 403) return `Gemini denied access (${message}) Check that the API key is enabled for the Gemini API.`;
  if (status === 429 && err?.retryAfterMs) {
    const minutes = Math.round(err.retryAfterMs / 60_000);
    const wait = minutes >= 90 ? `about ${Math.round(minutes / 60)} hours` : `about ${Math.max(1, minutes)} minutes`;
    return `Gemini quota used up: Gemini asked to wait ${wait}, which usually means the free tier's daily request limit is reached. AI review resumes after the quota resets (use "Re-run review" then); enabling billing on the Google AI account raises the limit.`;
  }
  if (status === 429) {
    const short = message.split(/\s+For more information|\s+\* Quota/)[0];
    return `Gemini rate limit or quota exceeded, still failing after retries (${short}) On the free tier, set GEMINI_RPM=5 in server/.env to space out requests.`;
  }
  if (status === 503) return `Gemini is temporarily overloaded, still failing after retries (${message})`;
  return status ? `Gemini API error ${status}: ${message}` : `Gemini request failed: ${message}`;
}

const toLlmError = (err) => new LlmError(describeGeminiError(err));

/**
 * Single structured-output call to Gemini. Returns the parsed JSON object
 * matching `schema`, or throws LlmError so callers fall back to heuristics.
 * Every call is logged as an `ai.call` event and, if `trace` is given, appended to it
 * (purpose, model, attempts, duration, token usage, outcome) so reviews keep a record.
 */
export async function callJSON({ system, prompt, schema, maxTokens = 16000, purpose = 'llm', trace = null, context = {} }) {
  const started = Date.now();
  const meta = { attempts: 0 };
  const record = (ok, extra = {}) => {
    const entry = { purpose, model: override ? 'test-override' : activeModel(), ok, attempts: meta.attempts, durationMs: Date.now() - started, ...extra };
    trace?.push({ at: new Date(), ...entry });
    (ok ? log.info : log.warn)('ai.call', { ...context, ...entry });
  };
  try {
    const value = await callOnce({ system, prompt, schema, maxTokens, meta, purpose });
    record(true, meta.usage ? { tokens: meta.usage } : {});
    return value;
  } catch (err) {
    record(false, { error: err.message });
    throw err;
  }
}

async function callOnce({ system, prompt, schema, maxTokens, meta, purpose }) {
  if (override) {
    meta.attempts = 1;
    return override({ system, prompt, schema });
  }
  let response;
  try {
    response = await withRetry(() => client().models.generateContent({
      model: activeModel(),
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        maxOutputTokens: maxTokens,
      },
    }), meta, purpose);
  } catch (err) {
    throw toLlmError(err);
  }
  const u = response.usageMetadata;
  if (u) meta.usage = { prompt: u.promptTokenCount ?? null, output: u.candidatesTokenCount ?? null, thinking: u.thoughtsTokenCount ?? null, total: u.totalTokenCount ?? null };

  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new LlmError(`Gemini blocked the request (${blocked}).`);
  const finish = response.candidates?.[0]?.finishReason;
  if (finish === 'MAX_TOKENS') throw new LlmError('Gemini response was truncated.');
  if (finish && finish !== 'STOP') throw new LlmError(`Gemini stopped early (${finish}).`);

  try {
    return JSON.parse(response.text || '');
  } catch {
    throw new LlmError('Gemini returned malformed JSON.');
  }
}

/**
 * Startup check that the configured model exists for this key, so a bad
 * GEMINI_MODEL or key shows up in the server log instead of on every claim.
 * Returns null when OK, otherwise a readable error message.
 */
export async function checkModel() {
  if (override || !llmAvailable()) return null;
  try {
    await client().models.get({ model: activeModel() });
    return null;
  } catch (err) {
    return describeGeminiError(err);
  }
}
