'use strict';

const crypto = require('node:crypto');
// Ephemeral HMAC key: fingerprints link reads within one Runtime process,
// without storing tool arguments, file names or plaintext search queries.
const processKey = crypto.randomBytes(32);
const READ_NAMES = /(?:^|[._-])(read|read_file|view|search|grep|ripgrep|find_file|list_files|inspect)(?:$|[._-])/i;
const SAFE_SHELL = /^\s*(?:cat|head|tail|rg|grep|ls|find|pwd|git\s+(?:show|diff|status|log)|sed\s+-n)\b/i;

function normalizedParameters(event) {
  const candidate = event?.info?.parameters ?? event?.info?.params ??
    event?.parameters ?? event?.args ?? event?.arguments ?? event?.input;
  if (typeof candidate === 'string') return candidate.slice(0, 2048);
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const keys = ['path', 'file_path', 'filePath', 'query', 'pattern', 'command',
    'cmd', 'relative_path', 'directory', 'glob', 'paths', 'args'];
  const selected = {};
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === 'string') selected[key] = value.slice(0, 2048);
    else if (Array.isArray(value) && value.every(item => typeof item === 'string'))
      selected[key] = value.slice(0, 24).map(item => item.slice(0, 2048));
  }
  return Object.keys(selected).length ? selected : null;
}

function readFingerprint(event, secret = processKey) {
  const name = String(event?.name || event?.tool_name || '').trim().toLowerCase();
  const params = normalizedParameters(event);
  if (!name || !params) return null;
  if (!READ_NAMES.test(name)) {
    const command = typeof params === 'string' ? params : params.command || params.cmd || '';
    if (!SAFE_SHELL.test(command)) return null;
  }
  return crypto.createHmac('sha256', secret).update(JSON.stringify([name, params]))
    .digest('hex').slice(0, 32);
}

module.exports = { readFingerprint };
