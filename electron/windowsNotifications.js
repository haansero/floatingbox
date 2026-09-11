'use strict';
/**
 * Windows 10/11: mirror the Action Center into the hub.
 *
 * WinRT's UserNotificationListener can read every toast the system received
 * (with the user's permission) and remove entries, but it cannot stop the toast
 * from being shown. To make the floating box the only place notifications
 * appear, turn off "banners" per app in Windows Settings; the toast then goes
 * straight to the Action Center, where this module picks it up within ~2s.
 *
 * We drive the API from the built-in Windows PowerShell 5.1 (WinRT projection),
 * so no native Node module is needed.
 */
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const POWERSHELL = 'powershell.exe';
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];
const ID_PREFIX = 'win:';

/** Scripts live outside app.asar (asarUnpack) because powershell.exe cannot read from the archive. */
function scriptPath(name) {
  return path.join(__dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), 'win', name);
}

/** Parse one JSON line from listener.ps1. Returns null for noise. */
function parseListenerLine(line) {
  const s = String(line || '').trim();
  if (!s.startsWith('{')) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o.type === 'string' ? o : null;
  } catch {
    return null;
  }
}

/** Convert a listener notification event into a hub payload. */
function toHubPayload(ev) {
  if (!ev || ev.type !== 'notification') return null;
  const title = String(ev.title || ev.app || '').trim();
  const body = String(ev.body || '').trim();
  if (!title && !body) return null;
  return {
    id: ID_PREFIX + ev.id,
    title: title || 'Notification',
    body,
    source: ev.app || 'windows',
    urgency: 'normal',
    ts: Number.isFinite(ev.time) ? ev.time : Date.now(),
  };
}

function startWindowsNotificationListener(hub, { log = () => {}, platform = process.platform, pollSeconds = 2 } = {}) {
  if (platform !== 'win32') return { ok: false, reason: 'not-windows' };

  const script = scriptPath('listener.ps1');
  let child = null;
  let stopped = false;
  let backoff = 2000;
  const state = { ok: true, reason: 'starting', ready: false };

  const spawnListener = () => {
    if (stopped) return;
    child = spawn(POWERSHELL, [...PS_ARGS, script, '-PollSeconds', String(pollSeconds)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const ev = parseListenerLine(line);
      if (!ev) return;
      if (ev.type === 'ready') {
        state.ready = true;
        state.reason = 'listening';
        backoff = 2000;
        log('windows listener ready');
      } else if (ev.type === 'notification') {
        const payload = toHubPayload(ev);
        if (!payload) return;
        // Existing Action Center items on first poll are imported already-read.
        const n = hub.push(payload, { source: 'windows' });
        if (n && ev.existing) n.read = true;
      } else if (ev.type === 'error') {
        state.reason = ev.reason;
        if (!ev.transient) state.ok = false;
        log('windows listener: ' + ev.reason);
      }
    });
    child.stderr.on('data', (d) => log('windows listener stderr: ' + String(d).trim()));
    child.on('error', (err) => log('windows listener spawn error: ' + err.message));
    child.on('exit', (code) => {
      log(`windows listener exited (code ${code})`);
      child = null;
      if (stopped) return;
      // Permanent failures (2,3,4) are not retried; crashes are, with backoff.
      if (code >= 2 && code <= 4) {
        state.ok = false;
        return;
      }
      setTimeout(spawnListener, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    });
  };

  const onDismissed = (hubId) => {
    if (!String(hubId).startsWith(ID_PREFIX)) return;
    const winId = hubId.slice(ID_PREFIX.length);
    if (!/^\d+$/.test(winId)) return;
    execFile(POWERSHELL, [...PS_ARGS, scriptPath('remove.ps1'), '-Id', winId], { windowsHide: true }, (err) => {
      if (err) log('remove failed: ' + err.message);
    });
  };
  hub.on('dismissed', onDismissed);

  spawnListener();

  return {
    get ok() { return state.ok; },
    get reason() { return state.reason; },
    stop() {
      stopped = true;
      hub.off('dismissed', onDismissed);
      if (child) child.kill();
    },
  };
}

module.exports = { startWindowsNotificationListener, parseListenerLine, toHubPayload, scriptPath, ID_PREFIX };
