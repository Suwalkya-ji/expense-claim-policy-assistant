// Structured logging: one JSON object per line on stdout/stderr, so hosting log
// viewers (Render, Docker, etc.) can filter by event, claimId, requestId…
//   {"ts":"…","level":"info","event":"ai.call","purpose":"classify","model":"…","durationMs":812,"ok":true}
// LOG_LEVEL = debug | info | warn | error | silent (default info; silent under `node --test`).
// LOG_FORMAT=pretty prints a short human-readable line instead, for local development.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const threshold = () => {
  const configured = process.env.LOG_LEVEL || (process.env.NODE_TEST_CONTEXT ? 'silent' : 'info');
  return LEVELS[configured] ?? LEVELS.info;
};

function write(level, event, fields = {}) {
  if (LEVELS[level] < threshold()) return;
  const entry = { ts: new Date().toISOString(), level, event, ...fields };
  if (entry.err instanceof Error) entry.err = { message: entry.err.message, stack: entry.err.stack };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (process.env.LOG_FORMAT === 'pretty') {
    const { ts, level: l, event: e, ...rest } = entry;
    const extra = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
    out.write(`${ts.slice(11, 19)} ${l.toUpperCase().padEnd(5)} ${e} ${extra}\n`);
  } else {
    out.write(`${JSON.stringify(entry)}\n`);
  }
}

export const log = {
  debug: (event, fields) => write('debug', event, fields),
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};

let counter = 0;
/** Express middleware: tags each request with an id and logs method, path, status and duration. */
export function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  req.id = req.get('x-request-id') || `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  res.set('x-request-id', req.id);
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api/')) return; // skip static asset noise
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    write(level, 'http.request', { requestId: req.id, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs });
  });
  next();
}
