'use strict';
// Runs only inside a session bus (dbus-run-session). Skipped elsewhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const { NotifyHub } = require('../electron/notifyHub');
const { startDesktopNotificationServer, stripMarkup } = require('../electron/dbusNotifications');

test('stripMarkup', () => {
  assert.equal(stripMarkup('<b>hi</b> &amp; bye'), 'hi & bye');
});

const hasBus = process.platform === 'linux' && !!process.env.DBUS_SESSION_BUS_ADDRESS;
test('owns org.freedesktop.Notifications and receives Notify()', { skip: !hasBus }, async () => {
  const hub = new NotifyHub();
  const server = await startDesktopNotificationServer(hub);
  assert.equal(server.ok, true, server.reason);
  const dbus = require('dbus-next');
  const bus = dbus.sessionBus();
  try {
    const obj = await bus.getProxyObject('org.freedesktop.Notifications', '/org/freedesktop/Notifications');
    const iface = obj.getInterface('org.freedesktop.Notifications');
    const hints = { urgency: new dbus.Variant('y', 2) };
    const id = await iface.Notify('TestApp', 0, '', 'Hello', '<i>world</i>', ['default', 'Open'], hints, 5000);
    assert.equal(typeof id, 'number');
    assert.equal(hub.items.length, 1);
    assert.equal(hub.items[0].title, 'Hello');
    assert.equal(hub.items[0].body, 'world');
    assert.equal(hub.items[0].source, 'TestApp');
    assert.equal(hub.items[0].urgency, 'critical');
    assert.deepEqual(hub.items[0].actions, ['Open']);
    const info = await iface.GetServerInformation();
    assert.equal(info[0], 'floatingbox');
    await iface.CloseNotification(id);
    assert.equal(hub.items.length, 0);
  } finally {
    bus.disconnect();
    server.stop();
  }
});
