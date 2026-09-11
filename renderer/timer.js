/* Work timer (stopwatch with optional target). Plain object so it can be unit tested in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkTimer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createTimer(state, now) {
    now = now || (() => Date.now());
    const t = {
      elapsedMs: 0,
      running: false,
      startedAt: null, // wall clock when the current run began
      targetMs: 0, // 0 = no target
      targetFired: false,
      ...(state || {}),
    };
    // If we were running when the app closed, keep counting from startedAt.
    if (t.running && t.startedAt == null) t.startedAt = now();

    return {
      get running() { return t.running; },
      get targetMs() { return t.targetMs; },
      elapsed() {
        return t.elapsedMs + (t.running ? Math.max(0, now() - t.startedAt) : 0);
      },
      start() {
        if (t.running) return;
        t.running = true;
        t.startedAt = now();
      },
      pause() {
        if (!t.running) return;
        t.elapsedMs = this.elapsed();
        t.running = false;
        t.startedAt = null;
      },
      toggle() { t.running ? this.pause() : this.start(); },
      reset() {
        t.elapsedMs = 0;
        t.running = false;
        t.startedAt = null;
        t.targetFired = false;
      },
      setTarget(ms) {
        t.targetMs = Math.max(0, ms | 0);
        t.targetFired = false;
      },
      /** true exactly once when the elapsed time passes the target */
      checkTarget() {
        if (!t.targetMs || t.targetFired) return false;
        if (this.elapsed() >= t.targetMs) {
          t.targetFired = true;
          return true;
        }
        return false;
      },
      snapshot() {
        return { elapsedMs: t.elapsedMs, running: t.running, startedAt: t.startedAt, targetMs: t.targetMs, targetFired: t.targetFired };
      },
    };
  }

  function format(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  }

  return { createTimer, format };
});
