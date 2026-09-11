'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Find the Claude Code OAuth access token on this machine.
 *  - Linux/Windows: ~/.claude/.credentials.json
 *  - macOS: Keychain item "Claude Code-credentials" (falls back to the file)
 * Returns { accessToken, subscriptionType, expiresAt } or null.
 */
function readClaudeCredentials({ home = os.homedir(), platform = process.platform } = {}) {
  const fromFile = readFile(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), '.credentials.json'));
  if (fromFile) return fromFile;
  if (platform === 'darwin') {
    try {
      const out = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return parse(out);
    } catch {
      return null;
    }
  }
  return null;
}

function readFile(file) {
  try {
    return parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function parse(raw) {
  try {
    const j = JSON.parse(raw);
    const o = j.claudeAiOauth || j;
    if (!o || !o.accessToken) return null;
    return { accessToken: o.accessToken, subscriptionType: o.subscriptionType, expiresAt: o.expiresAt };
  } catch {
    return null;
  }
}

module.exports = { readClaudeCredentials, parseCredentials: parse };
