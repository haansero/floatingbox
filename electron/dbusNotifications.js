'use strict';
/**
 * Linux only: become the desktop notification daemon.
 *
 * Desktop apps send notifications over D-Bus to org.freedesktop.Notifications.
 * By owning that name (replacing the current daemon such as dunst / gnome-shell's
 * server) every notification on the desktop lands in our hub instead of a popup.
 *
 * Spec: https://specifications.freedesktop.org/notification-spec/latest/
 */
const URGENCY = ['low', 'normal', 'critical'];

async function startDesktopNotificationServer(hub, { log = () => {} } = {}) {
  if (process.platform !== 'linux') {
    return { ok: false, reason: 'not-linux' };
  }
  let dbus;
  try {
    dbus = require('dbus-next');
  } catch (e) {
    return { ok: false, reason: 'dbus-next missing: ' + e.message };
  }
  const { Interface, method, signal, ACCESS_READ } = dbus.interface;

  let nextId = 1;
  const idMap = new Map(); // dbus id -> hub id

  class Notifications extends Interface {
    constructor() {
      super('org.freedesktop.Notifications');
    }

    GetCapabilities() {
      return ['body', 'body-markup', 'actions', 'persistence'];
    }

    GetServerInformation() {
      return ['floatingbox', 'floatingbox', '0.1.0', '1.2'];
    }

    Notify(appName, replacesId, appIcon, summary, body, actions, hints, expireTimeout) {
      const id = replacesId && replacesId > 0 ? replacesId : nextId++;
      if (nextId > 0xfffffffe) nextId = 1;
      let urgency = 'normal';
      const u = hints && hints.urgency;
      if (u && typeof u.value === 'number' && URGENCY[u.value]) urgency = URGENCY[u.value];
      // actions come as [key, label, key, label, ...]
      const labels = [];
      for (let i = 1; i < actions.length; i += 2) labels.push(String(actions[i]));
      if (replacesId && idMap.has(replacesId)) hub.dismiss(idMap.get(replacesId));
      const n = hub.push(
        { title: summary, body: stripMarkup(body), source: appName || 'desktop', urgency, actions: labels },
        { source: 'desktop' }
      );
      if (n) idMap.set(id, n.id);
      log(`dbus notify #${id} from ${appName}: ${summary}`);
      return id;
    }

    CloseNotification(id) {
      const hubId = idMap.get(id);
      if (hubId) {
        hub.dismiss(hubId);
        idMap.delete(id);
        this.NotificationClosed(id, 3);
      }
    }

    NotificationClosed(id, reason) {
      return [id, reason];
    }

    ActionInvoked(id, actionKey) {
      return [id, actionKey];
    }
  }

  Notifications.configureMembers({
    methods: {
      GetCapabilities: { outSignature: 'as' },
      GetServerInformation: { outSignature: 'ssss' },
      Notify: { inSignature: 'susssasa{sv}i', outSignature: 'u' },
      CloseNotification: { inSignature: 'u' },
    },
    signals: {
      NotificationClosed: { signature: 'uu' },
      ActionInvoked: { signature: 'us' },
    },
  });
  void method; void signal; void ACCESS_READ;

  const bus = dbus.sessionBus();
  const iface = new Notifications();
  bus.export('/org/freedesktop/Notifications', iface);
  try {
    const flags = dbus.NameFlag.REPLACE_EXISTING | dbus.NameFlag.DO_NOT_QUEUE | dbus.NameFlag.ALLOW_REPLACEMENT;
    const reply = await bus.requestName('org.freedesktop.Notifications', flags);
    // 1 = primary owner, 4 = replaced existing owner... (RequestNameReply)
    if (reply !== dbus.RequestNameReply.PRIMARY_OWNER) {
      bus.disconnect();
      return { ok: false, reason: `could not own name (reply=${reply})` };
    }
  } catch (e) {
    try { bus.disconnect(); } catch { /* ignore */ }
    return { ok: false, reason: e.message };
  }

  // Keep the hub -> dbus link: dismissing in the UI closes it for the sender too.
  hub.on('dismissed', (hubId) => {
    for (const [id, h] of idMap) {
      if (h === hubId) {
        idMap.delete(id);
        try { iface.NotificationClosed(id, 2); } catch { /* ignore */ }
      }
    }
  });

  return {
    ok: true,
    reason: 'dbus org.freedesktop.Notifications',
    stop: () => {
      try { bus.disconnect(); } catch { /* ignore */ }
    },
  };
}

function stripMarkup(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

module.exports = { startDesktopNotificationServer, stripMarkup };
