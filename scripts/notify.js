#!/usr/bin/env node
'use strict';
/**
 * Send a notification to the floating box from any script.
 *
 *   node scripts/notify.js "제목" "본문" [--source=name] [--urgency=low|normal|critical] [--url=https://...]
 *   echo '{"title":"...","body":"..."}' | node scripts/notify.js --stdin
 *
 * Used by the Claude Code hooks in hooks/claude-settings.example.json.
 */
const http = require('node:http');

const args = process.argv.slice(2);
const opts = { port: process.env.FLOATINGBOX_PORT || 47831 };
const positional = [];
for (const a of args) {
  const m = /^--([a-z]+)(?:=(.*))?$/i.exec(a);
  if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
  else positional.push(a);
}

async function main() {
  let payload;
  if (opts.stdin) {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    payload = fromHookInput(raw);
  } else {
    payload = { title: positional[0] || 'Notification', body: positional[1] || '' };
  }
  for (const k of ['source', 'urgency', 'url', 'title', 'body']) if (typeof opts[k] === 'string') payload[k] = opts[k];
  await post(payload);
}

/** Accept either our own payload or a Claude Code hook JSON on stdin. */
function fromHookInput(raw) {
  let j = {};
  try { j = JSON.parse(raw); } catch { return { title: 'Notification', body: raw.trim() }; }
  if (j.title || j.body) return j;
  // Claude Code hook input: { session_id, hook_event_name, message, title, cwd, ... }
  const event = j.hook_event_name || 'Claude Code';
  const project = j.cwd ? j.cwd.split(/[\\/]/).pop() : '';
  const body = j.message || j.last_assistant_message || (event === 'Stop' ? '응답이 완료되었습니다.' : '');
  return {
    title: j.title || `Claude Code · ${event}${project ? ' · ' + project : ''}`,
    body: String(body).slice(0, 500),
    source: 'claude-code',
    urgency: event === 'Notification' ? 'critical' : 'normal',
  };
}

function post(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      { host: '127.0.0.1', port: opts.port, path: '/notify', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', reject);
    req.end(data);
  });
}

main().catch((e) => {
  // Hooks must never block Claude Code: log and exit 0.
  console.error('floatingbox notify failed:', e.message);
});
