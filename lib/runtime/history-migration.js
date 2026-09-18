const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 800 * 1024 * 1024;
const IMPORT_HEADER = 'x-crew-history-import-token';
const ALLOWED_PREFIXES = [
  '.gemini/antigravity-cli/brain/',
  '.codex/sessions/',
  '.crew-pocket/conversation-settings.json',
  '.crew-pocket/live-memos/'
];

function tokenMatches(candidate, expected) {
  if (!expected || !candidate) return false;
  const left = Buffer.from(String(candidate));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function safeArchivePath(entry) {
  const normalized = String(entry || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return false;
  return ALLOWED_PREFIXES.some(prefix => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function createHistoryMigration({ homeDir, token }) {
  const state = { status: 'idle', importedAt: null, error: '', bytes: 0 };
  const importDir = path.join(homeDir, '.crew-pocket', 'history-import');

  async function receive(req, res) {
    if (!tokenMatches(req.headers[IMPORT_HEADER], token)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid history migration token' }));
    }
    if (state.status === 'importing') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'History migration is already running' }));
    }

    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_ARCHIVE_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'History archive is too large' }));
    }

    state.status = 'importing';
    state.error = '';
    state.bytes = 0;
    await fsPromises.mkdir(importDir, { recursive: true, mode: 0o700 });
    const archive = path.join(importDir, `history-${Date.now()}.tar.gz`);
    const output = fs.createWriteStream(archive, { mode: 0o600 });

    try {
      await new Promise((resolve, reject) => {
        req.on('data', chunk => {
          state.bytes += chunk.length;
          if (state.bytes > MAX_ARCHIVE_BYTES) {
            reject(new Error('History archive exceeded the size limit'));
            req.destroy();
            return;
          }
          if (!output.write(chunk)) req.pause(), output.once('drain', () => req.resume());
        });
        req.on('end', () => output.end(resolve));
        req.on('error', reject);
        output.on('error', reject);
      });

      const { stdout } = await execFileAsync('/system/bin/tar', ['-tzf', archive], { maxBuffer: 16 * 1024 * 1024 });
      const entries = String(stdout).split('\n').filter(Boolean);
      if (!entries.length || entries.some(entry => !safeArchivePath(entry))) {
        throw new Error('History archive contains an unsupported path');
      }
      await execFileAsync('/system/bin/tar', ['-xzf', archive, '-C', homeDir], { maxBuffer: 4 * 1024 * 1024 });
      await fsPromises.rm(archive, { force: true });
      await fsPromises.writeFile(path.join(importDir, 'complete.json'), JSON.stringify({ importedAt: Date.now(), bytes: state.bytes }), { mode: 0o600 });
      state.status = 'complete';
      state.importedAt = Date.now();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, status: state.status }));
    } catch (error) {
      output.destroy();
      await fsPromises.rm(archive, { force: true }).catch(() => {});
      state.status = 'failed';
      state.error = String(error?.message || error).slice(0, 500);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: state.error }));
    }
  }

  function status(req, res) {
    if (!tokenMatches(req.headers[IMPORT_HEADER], token)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid history migration token' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
  }

  return { receive, status };
}

module.exports = { createHistoryMigration };
