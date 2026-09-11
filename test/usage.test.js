'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const usage = require('../electron/usage');

test('parsePlanUsage maps known buckets, orders them, tolerates junk', () => {
  const out = usage.parsePlanUsage({
    seven_day: { utilization: 42.5, resets_at: '2026-09-15T00:00:00Z' },
    five_hour: { utilization: 12, resets_at: '2026-09-11T12:00:00Z' },
    something_new: { utilization: 3 },
    extra_usage: { is_enabled: false },
    seven_day_opus: { utilization: 150 },
    nope: 'string',
  });
  assert.deepEqual(out.map((b) => b.key), ['five_hour', 'seven_day', 'seven_day_opus', 'something_new']);
  assert.equal(out[0].label, '세션 (5시간)');
  assert.equal(out[1].percent, 42.5);
  assert.equal(out[2].percent, 100);
  assert.equal(out[3].label, 'Something New');
  assert.deepEqual(usage.parsePlanUsage(null), []);
});

test('fetchPlanUsage sends bearer token and surfaces status', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ five_hour: { utilization: 7 } }) };
  };
  const out = await usage.fetchPlanUsage('tok', { fetchImpl });
  assert.equal(seen.url, usage.USAGE_URL);
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(out[0].percent, 7);
  await assert.rejects(
    usage.fetchPlanUsage('tok', { fetchImpl: async () => ({ ok: false, status: 401 }) }),
    (e) => e.status === 401
  );
});

function line(ts, id, req, tokens, extra = {}) {
  return JSON.stringify({
    type: 'assistant', timestamp: ts, requestId: req, sessionId: extra.sessionId || 's1',
    message: { id, model: extra.model || 'claude-fable-5-1', usage: { input_tokens: tokens, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 } },
  });
}

test('collectCodeUsage aggregates today / week / session and dedupes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-usage-'));
  const proj = path.join(dir, '-home-me-proj');
  fs.mkdirSync(proj);
  const now = Date.parse('2026-09-11T10:00:00Z');
  const h = 3600 * 1000;
  const a = [
    line(new Date(now - 1 * h).toISOString(), 'm1', 'r1', 100),
    line(new Date(now - 1 * h).toISOString(), 'm1', 'r1', 100), // duplicate (streaming re-emit)
    line(new Date(now - 30 * h).toISOString(), 'm2', 'r2', 200, { model: 'claude-opus-5' }),
    '{"type":"user","timestamp":"2026-09-11T09:00:00Z"}',
    'garbage',
  ].join('\n');
  const b = [line(new Date(now - 10 * 24 * h).toISOString(), 'm3', 'r3', 999, { sessionId: 'old' })].join('\n');
  fs.writeFileSync(path.join(proj, 'a.jsonl'), a);
  fs.writeFileSync(path.join(proj, 'b.jsonl'), b);

  const r = await usage.collectCodeUsage({ projectsDir: dir, now });
  assert.equal(r.filesScanned, 2);
  assert.equal(r.week.input, 300);
  assert.equal(r.week.messages, 2);
  assert.equal(r.last5h.input, 100);
  assert.equal(r.byModel['claude-opus-5'].input, 200);
  assert.equal(r.latestSession.sessionId, 's1');
  assert.equal(r.latestSession.totals.input, 300);
  assert.equal(usage.totalTokens(r.week), 300 + 20 + 10 + 2);
  // "today" depends on local midnight; the 1h-ago record must count when it is after local midnight
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const expectToday = now - 1 * h >= startOfToday.getTime() ? 100 : 0;
  assert.equal(r.today.input, expectToday + (now - 30 * h >= startOfToday.getTime() ? 200 : 0));
  fs.rmSync(dir, { recursive: true });
});

test('parseTranscriptLine ignores non-assistant lines quickly', () => {
  assert.equal(usage.parseTranscriptLine(''), null);
  assert.equal(usage.parseTranscriptLine('{"type":"user"}'), null);
  assert.equal(usage.parseTranscriptLine('{"type":"assistant","message":{}}'), null);
});
