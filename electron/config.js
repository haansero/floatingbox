'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DEFAULTS = {
  // Local notification hub (HTTP). Anything on this machine can POST here.
  hubPort: 47831,
  // Poll interval for Claude usage, ms
  usagePollMs: 60_000,
  // Take over the desktop notification daemon on Linux (org.freedesktop.Notifications)
  captureDesktopNotifications: true,
  // Window position / size persisted between runs
  window: { x: undefined, y: undefined, width: 320, height: 600 },
  // Remembered timer state (so a restart does not lose the elapsed time)
  timer: { elapsedMs: 0, running: false, startedAt: null },
  opacity: 0.94,
};

function configPath(userDataDir) {
  return path.join(userDataDir || path.join(os.homedir(), '.floatingbox'), 'config.json');
}

function load(userDataDir) {
  const file = configPath(userDataDir);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return deepMerge(structuredClone(DEFAULTS), raw);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function save(userDataDir, cfg) {
  const file = configPath(userDataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      base[k] = deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

module.exports = { DEFAULTS, load, save, configPath, deepMerge };
