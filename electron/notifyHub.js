'use strict';
/**
 * Notification hub.
 *
 * Every notification that reaches the floating box goes through `hub.push()`.
 * Sources:
 *   - HTTP  : POST http://127.0.0.1:<port>/notify  {title, body, source, urgency, actions}
 *             (Claude Code hooks, shell scripts, CI, anything local)
 *   - D-Bus : org.freedesktop.Notifications (Linux only, see dbusNotifications.js)
 *   - App   : timer finished, usage threshold crossed, ...
 */
const http = require('node:http');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const MAX_ITEMS = 200;
const URGENCIES = new Set(['low', 'normal', 'critical']);

function normalize(input, defaults = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const title = String(src.title ?? src.summary ?? defaults.title ?? '').trim();
  const body = String(src.body ?? src.message ?? src.text ?? '').trim();
  if (!title && !body) return null;
  let urgency = String(src.urgency ?? defaults.urgency ?? 'normal').toLowerCase();
  if (!URGENCIES.has(urgency)) urgency = 'normal';
  const actions = Array.isArray(src.actions)
    ? src.actions.filter((a) => typeof a === 'string').slice(0, 6)
    : [];
  return {
    id: src.id ? String(src.id) : crypto.randomUUID(),
    title: title || (defaults.title ?? 'Notification'),
    body,
    source: String(src.source ?? src.app_name ?? src.appName ?? defaults.source ?? 'local'),
    urgency,
    actions,
    url: typeof src.url === 'string' ? src.url : undefined,
    ts: Number.isFinite(src.ts) ? Number(src.ts) : Date.now(),
    read: false,
  };
}

class NotifyHub extends EventEmitter {
  constructor({ port = 47831, host = '127.0.0.1' } = {}) {
    super();
    this.port = port;
    this.host = host;
    this.items = [];
    this.server = null;
  }

  push(raw, defaults) {
    const n = normalize(raw, defaults);
    if (!n) return null;
    this.items.unshift(n);
    if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    this.emit('notification', n);
    return n;
  }

  markRead(id) {
    const n = this.items.find((x) => x.id === id);
    if (n) n.read = true;
    this.emit('change');
    return !!n;
  }

  dismiss(id) {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length !== before) this.emit('dismissed', id);
    this.emit('change');
    return this.items.length !== before;
  }

  clear() {
    this.items = [];
    this.emit('change');
  }

  unreadCount() {
    return this.items.filter((x) => !x.read).length;
  }

  /** Start the local HTTP endpoint. Resolves with the bound port. */
  listen() {
    if (this.server) return Promise.resolve(this.port);
    this.server = http.createServer((req, res) => this._handle(req, res));
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  _handle(req, res) {
    const url = new URL(req.url, `http://${this.host}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && url.pathname === '/health') {
      return res.end(JSON.stringify({ ok: true, count: this.items.length, unread: this.unreadCount() }));
    }
    if (req.method === 'GET' && url.pathname === '/notifications') {
      return res.end(JSON.stringify(this.items));
    }
    if (req.method === 'POST' && url.pathname === '/notify') {
      let buf = '';
      req.on('data', (c) => {
        buf += c;
        if (buf.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        let payload;
        try {
          payload = buf ? JSON.parse(buf) : {};
        } catch {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
        }
        // Allow ?title=..&body=.. for curl one-liners
        for (const k of ['title', 'body', 'source', 'urgency']) {
          if (url.searchParams.has(k) && payload[k] === undefined) payload[k] = url.searchParams.get(k);
        }
        const n = this.push(payload, { source: 'http' });
        if (!n) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: 'title or body required' }));
        }
        res.statusCode = 201;
        res.end(JSON.stringify({ ok: true, id: n.id }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }
}

module.exports = { NotifyHub, normalize, MAX_ITEMS };
