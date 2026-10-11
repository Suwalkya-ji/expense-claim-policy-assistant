import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { router, errorHandler } from './routes/claims.js';
import { requestLogger } from './logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '../../client/dist');

/**
 * Optional shared login for a hosted demo: set APP_USERNAME and APP_PASSWORD and the
 * browser asks for them once (HTTP Basic auth). The health check stays open for the host.
 */
function basicAuth(req, res, next) {
  const user = process.env.APP_USERNAME;
  const pass = process.env.APP_PASSWORD;
  if (!user || !pass || req.path === '/api/health') return next();
  const [scheme, encoded] = String(req.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const i = decoded.indexOf(':');
    const ok = safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass);
    if (i > 0 && ok) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Expense Claim Review", charset="UTF-8"');
  res.status(401).json({ error: 'Login required' });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(requestLogger);
  app.use(basicAuth);
  app.use(express.json({ limit: '1mb' }));
  // Used by the hosting platform's health check: 503 until MongoDB is connected.
  app.get('/api/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.status(db === 'connected' ? 200 : 503).json({ ok: db === 'connected', db });
  });
  app.use('/api', router);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production, serve the built React app from the same origin.
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
