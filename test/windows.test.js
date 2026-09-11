'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseListenerLine, toHubPayload, startWindowsNotificationListener, ID_PREFIX } = require('../electron/windowsNotifications');
const { NotifyHub } = require('../electron/notifyHub');

test('parseListenerLine only accepts typed JSON objects', () => {
  assert.equal(parseListenerLine(''), null);
  assert.equal(parseListenerLine('WARNING: something'), null);
  assert.equal(parseListenerLine('{"foo":1}'), null);
  assert.deepEqual(parseListenerLine(' {"type":"ready"} '), { type: 'ready' });
});

test('toHubPayload maps a listener event, falls back to app name', () => {
  const p = toHubPayload({ type: 'notification', id: 42, app: 'Slack', title: '새 메시지', body: '회의 10분 뒤', time: 1700000000000 });
  assert.equal(p.id, ID_PREFIX + '42');
  assert.equal(p.source, 'Slack');
  assert.equal(p.ts, 1700000000000);
  assert.equal(toHubPayload({ type: 'notification', id: 1, app: 'Mail', title: '', body: '' }).title, 'Mail');
  assert.equal(toHubPayload({ type: 'notification', id: 1, app: '', title: '', body: '' }), null);
  assert.equal(toHubPayload({ type: 'error' }), null);
  const q = toHubPayload({ type: 'notification', id: 2, app: 'Mail', title: '', body: 'x' });
  assert.equal(q.title, 'Mail');
});

test('listener refuses to start off Windows', () => {
  const r = startWindowsNotificationListener(new NotifyHub(), { platform: 'linux' });
  assert.deepEqual(r, { ok: false, reason: 'not-windows' });
});
