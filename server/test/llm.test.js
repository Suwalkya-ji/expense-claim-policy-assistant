import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { activeModel, callJSON, llmAvailable, LlmError } from '../src/services/llm.js';

const KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_MODEL', 'AI_DISABLED'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
});
const clear = () => KEYS.forEach((k) => delete process.env[k]);

test('AI is available only with a Gemini key', () => {
  clear();
  assert.equal(llmAvailable(), false);
  process.env.GEMINI_API_KEY = 'g';
  assert.equal(llmAvailable(), true);
  assert.equal(activeModel(), 'gemini-3.8-flash');
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  assert.equal(activeModel(), 'gemini-2.5-pro');
  process.env.AI_DISABLED = 'true';
  assert.equal(llmAvailable(), false);
});

const geminiReply = (body, status = 200) => async (url, init) => {
  geminiReply.last = { url: String(url), body: JSON.parse(init.body) };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};

test('Gemini call sends a JSON schema and parses the JSON reply', async () => {
  clear();
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = geminiReply({ candidates: [{ content: { role: 'model', parts: [{ text: '{"category":"meals"}' }] }, finishReason: 'STOP' }] });
  const schema = { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] };
  const out = await callJSON({ system: 'sys', prompt: 'hello', schema });
  assert.deepEqual(out, { category: 'meals' });
  assert.match(geminiReply.last.url, /gemini-3\.8-flash:generateContent/);
  assert.equal(geminiReply.last.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(geminiReply.last.body.generationConfig.responseJsonSchema, schema);
  assert.equal(geminiReply.last.body.systemInstruction.parts[0].text, 'sys');
});

test('Gemini errors, truncation and bad JSON become LlmError', async () => {
  clear();
  process.env.GEMINI_API_KEY = 'test-key';
  const args = { system: 's', prompt: 'p', schema: { type: 'object' } };
  globalThis.fetch = geminiReply({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } }, 400);
  await assert.rejects(callJSON(args), LlmError);
  globalThis.fetch = geminiReply({ candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: 'MAX_TOKENS' }] });
  await assert.rejects(callJSON(args), /truncated/);
  globalThis.fetch = geminiReply({ candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }] });
  await assert.rejects(callJSON(args), /malformed JSON/);
});

test('Gemini errors are turned into readable messages with a fix hint', async () => {
  const { describeGeminiError } = await import('../src/services/llm.js');
  clear();
  const raw = { status: 404, message: '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users.","status":"NOT_FOUND"}}' };
  const msg = describeGeminiError(raw);
  assert.match(msg, /^Gemini model "gemini-3\.8-flash" is not available/);
  assert.match(msg, /no longer available to new users/);
  assert.match(msg, /Set GEMINI_MODEL/);
  assert.doesNotMatch(msg, /\{"error"/, 'raw JSON is not shown');
  assert.match(describeGeminiError({ status: 400, message: '{"error":{"message":"API key not valid."}}' }), /Check GEMINI_API_KEY/);
  assert.equal(describeGeminiError(new Error('socket hang up')), 'Gemini request failed: socket hang up');
});

test('rate limits and overloads are retried, honouring "retry in Ns"', async () => {
  const { setSleep, retryDelayMs } = await import('../src/services/llm.js');
  clear();
  process.env.GEMINI_API_KEY = 'test-key';
  const waits = [];
  setSleep(async (ms) => waits.push(ms));
  const replies = [
    [429, { error: { code: 429, message: 'You exceeded your current quota. Please retry in 10.136319099s.', status: 'RESOURCE_EXHAUSTED' } }],
    [503, { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }],
    [200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }] }],
  ];
  let calls = 0;
  globalThis.fetch = async () => {
    const [status, body] = replies[calls++];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await callJSON({ system: 's', prompt: 'p', schema: { type: 'object' } }), { ok: true });
    assert.equal(calls, 3);
    assert.equal(waits[0], 10137 + 250, 'waits as long as Gemini asked');
    assert.equal(waits[1], 4000 + 250, 'exponential backoff when no delay is given');
  } finally {
    setSleep((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  assert.equal(retryDelayMs({ message: 'Please retry in 361.550154ms.' }), 362);
  assert.equal(retryDelayMs({ message: 'no hint' }), null);
});

test('long waits (daily quota) and non-retryable errors fail fast', async () => {
  const { setSleep } = await import('../src/services/llm.js');
  clear();
  process.env.GEMINI_API_KEY = 'test-key';
  const waits = [];
  setSleep(async (ms) => waits.push(ms));
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded. Please retry in 3600s.' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(callJSON({ system: 's', prompt: 'p', schema: { type: 'object' } }), /quota used up: Gemini asked to wait about 60 minutes.*daily request limit/);
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  } finally {
    setSleep((ms) => new Promise((r) => setTimeout(r, ms)));
  }
});
