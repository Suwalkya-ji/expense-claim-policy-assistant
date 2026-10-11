import { test } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/logger.js';

function capture(fn) {
  const lines = [];
  const [out, err] = [process.stdout.write, process.stderr.write];
  process.stdout.write = process.stderr.write = (chunk) => (lines.push(String(chunk)), true);
  try {
    fn();
  } finally {
    [process.stdout.write, process.stderr.write] = [out, err];
  }
  return lines;
}

test('logs are one JSON object per line, filtered by LOG_LEVEL', () => {
  const saved = [process.env.LOG_LEVEL, process.env.LOG_FORMAT];
  process.env.LOG_LEVEL = 'info';
  delete process.env.LOG_FORMAT;
  try {
    const lines = capture(() => {
      log.debug('hidden', {});
      log.info('ai.call', { purpose: 'classify', ok: true, durationMs: 12 });
      log.error('http.error', { err: new Error('boom') });
    });
    assert.equal(lines.length, 2, 'debug is below the info threshold');
    const first = JSON.parse(lines[0]);
    assert.equal(first.level, 'info');
    assert.equal(first.event, 'ai.call');
    assert.equal(first.purpose, 'classify');
    assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(JSON.parse(lines[1]).err.message, 'boom', 'errors are serialised');
  } finally {
    if (saved[0] === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved[0];
    if (saved[1] !== undefined) process.env.LOG_FORMAT = saved[1];
  }
});
