// Loads server/.env by absolute path, so it works whichever folder the server is started from,
// and explains at startup why AI review is off when the Gemini key isn't found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = path.join(SERVER_DIR, '.env');

const result = dotenv.config({ path: ENV_PATH, quiet: true });
export const envLoaded = !result.error;

/** A human-readable reason the Gemini key is missing, or null when it is set. */
export function missingKeyReason() {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return null;
  if (!envLoaded) {
    const txt = `${ENV_PATH}.txt`;
    if (fs.existsSync(txt)) return `Found ${txt} — rename it to .env (Windows added ".txt").`;
    return `GEMINI_API_KEY is not set. Locally: copy server/.env.example to server/.env and set it. When hosted: add it as an environment variable.`;
  }
  const keys = Object.keys(result.parsed || {});
  const nearMiss = keys.find((k) => k !== 'GEMINI_API_KEY' && /gemini|google/i.test(k) && /key/i.test(k));
  if (nearMiss) return `${ENV_PATH} has "${nearMiss}" — the name must be exactly GEMINI_API_KEY.`;
  if (keys.includes('GEMINI_API_KEY')) return `GEMINI_API_KEY is empty in ${ENV_PATH}.`;
  return `GEMINI_API_KEY is not set in ${ENV_PATH}.`;
}
