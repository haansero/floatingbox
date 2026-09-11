'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../electron/config');
const { parseCredentials } = require('../electron/credentials');

test('config round-trips and merges defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-cfg-'));
  const c = config.load(dir);
  assert.equal(c.hubPort, config.DEFAULTS.hubPort);
  c.hubPort = 5000; c.window.width = 999;
  config.save(dir, c);
  const again = config.load(dir);
  assert.equal(again.hubPort, 5000);
  assert.equal(again.window.width, 999);
  assert.equal(again.window.height, config.DEFAULTS.window.height);
  fs.rmSync(dir, { recursive: true });
});

test('credentials parser handles Claude Code file shape', () => {
  assert.deepEqual(parseCredentials('{"claudeAiOauth":{"accessToken":"a","subscriptionType":"max","expiresAt":1}}'),
    { accessToken: 'a', subscriptionType: 'max', expiresAt: 1 });
  assert.equal(parseCredentials('{}'), null);
  assert.equal(parseCredentials('nope'), null);
});
