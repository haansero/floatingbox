'use strict';
/**
 * Claude usage, two sources:
 *
 *  1. Plan limits (세션 5시간 / 주간 종합 / 주간 모델별)
 *     GET https://api.anthropic.com/api/oauth/usage with the Claude Code OAuth token.
 *     This is the same data `/usage` inside Claude Code shows. It is an
 *     undocumented endpoint, so the parser is deliberately tolerant: every
 *     object with a numeric `utilization` becomes a bucket.
 *
 *  2. Claude Code token usage (Code)
 *     Parsed locally from ~/.claude/projects/** /*.jsonl transcripts.
 *     Aggregated for the current session, today and the last 7 days.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const BUCKET_LABELS = {
  five_hour: '세션 (5시간)',
  seven_day: '주간 종합',
  seven_day_opus: '주간 Opus',
  seven_day_sonnet: '주간 Sonnet',
  seven_day_oauth_apps: '주간 연동 앱',
  seven_day_code: '주간 Claude Code',
};

const BUCKET_ORDER = Object.keys(BUCKET_LABELS);

/** Turn the raw /api/oauth/usage response into a sorted list of buckets. */
function parsePlanUsage(json) {
  if (!json || typeof json !== 'object') return [];
  const out = [];
  for (const [key, val] of Object.entries(json)) {
    if (!val || typeof val !== 'object') continue;
    const util = Number(val.utilization);
    if (!Number.isFinite(util)) continue;
    out.push({
      key,
      label: BUCKET_LABELS[key] || prettify(key),
      percent: Math.max(0, Math.min(100, util <= 1 && util > 0 && !('resets_at' in val) ? util * 100 : util)),
      resetsAt: val.resets_at || val.resetsAt || null,
    });
  }
  out.sort((a, b) => orderOf(a.key) - orderOf(b.key));
  return out;
}

function orderOf(key) {
  const i = BUCKET_ORDER.indexOf(key);
  return i === -1 ? 100 : i;
}

function prettify(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchPlanUsage(accessToken, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
        'User-Agent': 'floatingbox/0.1',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`usage endpoint ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return parsePlanUsage(await res.json());
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Local Claude Code transcripts

function emptyTotals() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 };
}

function addUsage(t, u) {
  t.input += u.input_tokens || 0;
  t.output += u.output_tokens || 0;
  t.cacheRead += u.cache_read_input_tokens || 0;
  t.cacheWrite += u.cache_creation_input_tokens || 0;
  t.messages += 1;
}

/**
 * Parse one transcript line. Returns {id, ts, model, usage, sessionId} or null.
 */
function parseTranscriptLine(line) {
  if (!line || line[0] !== '{' || !line.includes('"assistant"')) return null;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (o.type !== 'assistant' || !o.message || !o.message.usage) return null;
  const ts = Date.parse(o.timestamp);
  if (!Number.isFinite(ts)) return null;
  return {
    id: `${o.message.id || ''}:${o.requestId || o.uuid || ''}`,
    ts,
    model: o.message.model || 'unknown',
    usage: o.message.usage,
    sessionId: o.sessionId || null,
  };
}

/**
 * Aggregate transcripts under `projectsDir` (default ~/.claude/projects).
 * Only files modified within `sinceMs` are read.
 */
async function collectCodeUsage({
  projectsDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'),
  now = Date.now(),
  sinceMs = 8 * 24 * 3600 * 1000,
} = {}) {
  const files = listJsonl(projectsDir).filter((f) => now - f.mtimeMs <= sinceMs);
  const seen = new Set();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const fiveHoursAgo = now - 5 * 3600 * 1000;

  const result = {
    today: emptyTotals(),
    week: emptyTotals(),
    last5h: emptyTotals(),
    byModel: {},
    latestSession: null,
    filesScanned: files.length,
  };
  let latest = null;

  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(f.path, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      const rec = parseTranscriptLine(line);
      if (!rec || seen.has(rec.id)) continue;
      seen.add(rec.id);
      if (rec.ts >= weekAgo) {
        addUsage(result.week, rec.usage);
        result.byModel[rec.model] ??= emptyTotals();
        addUsage(result.byModel[rec.model], rec.usage);
      }
      if (rec.ts >= startOfToday.getTime()) addUsage(result.today, rec.usage);
      if (rec.ts >= fiveHoursAgo) addUsage(result.last5h, rec.usage);
      if (!latest || rec.ts > latest.ts) latest = { ts: rec.ts, sessionId: rec.sessionId, file: f.path };
    }
  }

  if (latest) {
    // Second pass over the latest session file only
    const s = emptyTotals();
    const rl = readline.createInterface({ input: fs.createReadStream(latest.file, 'utf8'), crlfDelay: Infinity });
    const seen2 = new Set();
    let first = Infinity;
    for await (const line of rl) {
      const rec = parseTranscriptLine(line);
      if (!rec || seen2.has(rec.id)) continue;
      seen2.add(rec.id);
      addUsage(s, rec.usage);
      if (rec.ts < first) first = rec.ts;
    }
    result.latestSession = { sessionId: latest.sessionId, startedAt: first, lastAt: latest.ts, totals: s };
  }
  return result;
}

function listJsonl(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          out.push({ path: p, mtimeMs: fs.statSync(p).mtimeMs });
        } catch { /* ignore */ }
      }
    }
  };
  walk(dir);
  return out;
}

function totalTokens(t) {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

module.exports = {
  USAGE_URL,
  BUCKET_LABELS,
  parsePlanUsage,
  fetchPlanUsage,
  parseTranscriptLine,
  collectCodeUsage,
  totalTokens,
  emptyTotals,
};
