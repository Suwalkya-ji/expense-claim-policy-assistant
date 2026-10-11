// Loads data/sample-claims.json through the real API pipeline.
// Usage: npm run seed            (adds sample claims)
//        npm run seed -- --reset (wipes all claims first)
import '../src/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Claim } from '../src/models/Claim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(fs.readFileSync(path.join(here, '../data/sample-claims.json'), 'utf8'));

const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const claims = samples.map(({ daysAgo, ...c }) => ({ ...c, date: isoDaysAgo(daysAgo) }));

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/expense_review');
if (process.argv.includes('--reset')) {
  const { deletedCount } = await Claim.deleteMany({});
  console.log(`Removed ${deletedCount} existing claims`);
}
const res = await request(createApp()).post('/api/claims').set('x-reviewer', 'seed-script').send({ claims });
if (res.status !== 201) {
  console.error('Seeding failed:', res.status, res.body);
  process.exitCode = 1;
} else {
  for (const c of res.body) console.log(`${c.claimant.padEnd(14)} ${String(c.amount).padStart(7)} ${c.currency}  → ${c.review.recommendation}${c.review.classification.uncertain ? ' (uncertain)' : ''}`);
}
await mongoose.disconnect();
