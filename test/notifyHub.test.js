'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NotifyHub, normalize, MAX_ITEMS } = require('../electron/notifyHub');

test('normalize fills defaults and rejects empty', () => {
  assert.equal(normalize({}), null);
  const n = normalize({ title: ' Hi ', body: 'there', urgency: 'LOUD', actions: ['a', 2, 'b'] }, { source: 'x' });
  assert.equal(n.title, 'Hi');
  assert.equal(n.urgency, 'normal');
  assert.equal(n.source, 'x');
  assert.deepEqual(n.actions, ['a', 'b']);
  assert.equal(n.read, false);
  assert.ok(n.id);
});

test('hub keeps newest first, caps size, tracks unread', () => {
  const hub = new NotifyHub();
  for (let i = 0; i < MAX_ITEMS + 10; i++) hub.push({ title: 't' + i });
  assert.equal(hub.items.length, MAX_ITEMS);
  assert.equal(hub.items[0].title, 't' + (MAX_ITEMS + 9));
  assert.equal(hub.unreadCount(), MAX_ITEMS);
  hub.markRead(hub.items[0].id);
  assert.equal(hub.unreadCount(), MAX_ITEMS - 1);
  const id = hub.items[1].id;
  let dismissed = null;
  hub.on('dismissed', (x) => (dismissed = x));
  assert.equal(hub.dismiss(id), true);
  assert.equal(dismissed, id);
  hub.clear();
  assert.equal(hub.items.length, 0);
});

test('HTTP endpoint accepts JSON and query params', async () => {
  const hub = new NotifyHub({ port: 0 });
  const port = await hub.listen();
  const got = [];
  hub.on('notification', (n) => got.push(n));
  try {
    let res = await fetch(`http://127.0.0.1:${port}/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Build', body: 'passed', source: 'ci', urgency: 'low' }),
    });
    assert.equal(res.status, 201);
    res = await fetch(`http://127.0.0.1:${port}/notify?title=Hey&body=Yo`, { method: 'POST' });
    assert.equal(res.status, 201);
    res = await fetch(`http://127.0.0.1:${port}/notify`, { method: 'POST', body: '{bad' });
    assert.equal(res.status, 400);
    res = await fetch(`http://127.0.0.1:${port}/notify`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 400);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual(health, { ok: true, count: 2, unread: 2 });
    const list = await (await fetch(`http://127.0.0.1:${port}/notifications`)).json();
    assert.equal(list[0].title, 'Hey');
    assert.equal(list[1].source, 'ci');
    assert.equal(got.length, 2);
  } finally {
    await hub.close();
  }
});
