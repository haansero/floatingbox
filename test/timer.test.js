'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimer, format } = require('../renderer/timer');

test('timer counts only while running and survives restore', () => {
  let t = 1000;
  const now = () => t;
  const timer = createTimer(null, now);
  assert.equal(timer.elapsed(), 0);
  timer.start(); t += 5000;
  assert.equal(timer.elapsed(), 5000);
  timer.pause(); t += 5000;
  assert.equal(timer.elapsed(), 5000);
  timer.start(); t += 1000;
  assert.equal(timer.elapsed(), 6000);
  // simulate app restart while running
  const restored = createTimer(timer.snapshot(), now);
  t += 4000;
  assert.equal(restored.elapsed(), 10000);
  restored.reset();
  assert.equal(restored.elapsed(), 0);
  assert.equal(restored.running, false);
});

test('target fires exactly once and resets with reset()', () => {
  let t = 0;
  const timer = createTimer(null, () => t);
  timer.setTarget(60_000);
  timer.start();
  t = 30_000; assert.equal(timer.checkTarget(), false);
  t = 60_000; assert.equal(timer.checkTarget(), true);
  t = 90_000; assert.equal(timer.checkTarget(), false);
  timer.reset(); timer.start(); t = 200_000;
  assert.equal(timer.checkTarget(), true);
});

test('format', () => {
  assert.equal(format(0), '00:00:00');
  assert.equal(format(3_723_000), '01:02:03');
});
