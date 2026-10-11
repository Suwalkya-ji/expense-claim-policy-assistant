import { ENV_PATH, envLoaded, missingKeyReason } from './env.js';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { log } from './logger.js';
import { activeModel, PROVIDER, checkModel, llmAvailable } from './services/llm.js';

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/expense_review';
// Hide credentials when logging the database location.
const safeUri = MONGODB_URI.replace(/\/\/[^@/]*@/, '//***@');

log.info('server.config', { settings: envLoaded ? ENV_PATH : 'not found (using environment variables and defaults)', db: safeUri });
try {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
} catch (err) {
  log.error('db.connect_failed', { db: safeUri, message: err.message, hint: 'Start MongoDB (docker compose up -d mongo) or set MONGODB_URI.' });
  process.exit(1);
}
log.info('db.connected', { db: safeUri });

createApp().listen(PORT, () => {
  log.info('server.started', { url: `http://localhost:${PORT}` });
  if (llmAvailable()) log.info('ai.enabled', { provider: PROVIDER, model: activeModel(), rpm: Number(process.env.GEMINI_RPM) || null });
  else if (process.env.AI_DISABLED === 'true') log.info('ai.disabled', { reason: 'AI_DISABLED=true' });
  else log.warn('ai.disabled', { reason: `${missingKeyReason()} Restart the server after editing .env.` });
});

const modelProblem = await checkModel();
if (modelProblem) log.warn('ai.model_check_failed', { reason: modelProblem, effect: 'Reviews will use the heuristic fallback until this is fixed.' });
else if (llmAvailable()) log.info('ai.model_check_ok', { model: activeModel() });
