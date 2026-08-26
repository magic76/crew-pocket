const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { BRAIN_DIR, UPLOADS_DIR, LEGACY_UPLOADS_DIR, PREVIOUS_UPLOADS_DIR, PUBLIC_DIR, cleanUserContent } = require('./config');
const { getCachedTitle } = require('./title');

const ROOTS = {
  photos: UPLOADS_DIR,
  public_cache: path.join(PUBLIC_DIR, 'uploads'),
  legacy_uploads: LEGACY_UPLOADS_DIR,
  previous_uploads: PREVIOUS_UPLOADS_DIR
};
const CODEX_SESSIONS_DIR = '/data/data/com.termux/files/home/.codex/sessions';
const MAX_MEDIA_ITEMS = 300;
const execFileAsync = promisify(execFile);

async function statSafe(target) {
  try { return await fs.stat(target); } catch (_) { return null; }
}

async function directorySize(directory) {
  let total = 0;
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (_) { return total; }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(target);
    else if (entry.isFile()) total += (await statSafe(target))?.size || 0;
  }
  return total;
}

async function listFiles(directory, rootKey, output) {
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await listFiles(target, rootKey, output);
    else if (entry.isFile()) {
      const stat = await statSafe(target);
      if (stat) {
        const ext = path.extname(entry.name).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'].includes(ext);
        const relativePath = path.relative(ROOTS[rootKey], target);
        const previewUrl = ['.heic', '.heif'].includes(ext)
          ? `/api/storage/thumbnail?root=${encodeURIComponent(rootKey)}&path=${encodeURIComponent(relativePath)}`
          : `/api/image?path=${encodeURIComponent(target)}`;
        output.push({ root: rootKey, path: relativePath, bytes: stat.size, modifiedAt: stat.mtimeMs, isImage, previewUrl });
      }
    }
  }
}

async function listAgyConversations() {
  let entries = [];
  try { entries = await fs.readdir(BRAIN_DIR, { withFileTypes: true }); } catch (_) { return []; }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(entry.name)) continue;
    const target = path.join(BRAIN_DIR, entry.name);
    const stat = await statSafe(target);
    const logDir = path.join(target, '.system_generated', 'logs');
    const fullLog = path.join(logDir, 'transcript_full.jsonl');
    const activeLog = path.join(logDir, 'transcript.jsonl');
    const preview = await transcriptPreview((await statSafe(fullLog)) ? fullLog : activeLog);
    if (preview || getCachedTitle(entry.name)) rows.push({ id: entry.name, provider: 'antigravity', title: getCachedTitle(entry.name) || preview || `AGY ${entry.name.slice(0, 8)}`, preview, bytes: await directorySize(target), modifiedAt: stat?.mtimeMs || 0 });
  }
  return rows;
}

async function transcriptPreview(logPath) {
  const stat = await statSafe(logPath);
  if (!stat?.isFile()) return '';
  const handle = await fs.open(logPath, 'r');
  try {
    const bytes = Math.min(stat.size, 192 * 1024);
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, Math.max(0, stat.size - bytes));
    let last = '';
    for (const line of buffer.toString('utf8').split('\n')) {
      try { const item = JSON.parse(line); if (item.type === 'USER_INPUT') { const text = cleanUserContent(item.content); if (text && !text.startsWith('/compact')) last = text; } } catch (_) {}
    }
    return last.slice(0, 96);
  } finally { await handle.close(); }
}

async function listCodexConversations() {
  const rows = [];
  async function visit(directory) {
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = await statSafe(target);
        // Codex stores rollout-<timestamp>-<thread UUID>.jsonl.  The UUID is
        // the provider thread id accepted by its safe deletion API.
        const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
        if (stat && match) {
          const preview = await codexPreview(target);
          rows.push({ id: match[1], provider: 'codex', title: preview || `Codex ${match[1].slice(0, 8)}`, preview, bytes: stat.size, modifiedAt: stat.mtimeMs });
        }
      }
    }
  }
  await visit(CODEX_SESSIONS_DIR);
  return rows;
}

async function codexPreview(sessionPath) {
  const stat = await statSafe(sessionPath);
  if (!stat?.isFile()) return '';
  const handle = await fs.open(sessionPath, 'r');
  try {
    const bytes = Math.min(stat.size, 192 * 1024); const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, Math.max(0, stat.size - bytes));
    let last = '';
    for (const line of buffer.toString('utf8').split('\n')) {
      try { const entry = JSON.parse(line); if (entry?.type === 'event_msg' && entry.payload?.type === 'user_message' && entry.payload.message) last = entry.payload.message; } catch (_) {}
    }
    return cleanUserContent(String(last)).replace(/\s+/g, ' ').trim().slice(0, 96);
  } finally { await handle.close(); }
}

async function getStorageReport() {
  const [agy, codex] = await Promise.all([listAgyConversations(), listCodexConversations()]);
  const media = [];
  await Promise.all(Object.keys(ROOTS).map(rootKey => listFiles(ROOTS[rootKey], rootKey, media)));
  media.sort((a, b) => b.bytes - a.bytes || b.modifiedAt - a.modifiedAt);
  const rootTotals = {};
  for (const item of media) rootTotals[item.root] = (rootTotals[item.root] || 0) + item.bytes;
  return {
    conversations: [...agy, ...codex].sort((a, b) => b.bytes - a.bytes),
    media: media.slice(0, MAX_MEDIA_ITEMS),
    mediaTruncated: media.length > MAX_MEDIA_ITEMS,
    totals: {
      conversations: [...agy, ...codex].reduce((total, item) => total + item.bytes, 0),
      media: media.reduce((total, item) => total + item.bytes, 0),
      roots: rootTotals
    }
  };
}

function resolveMediaItem(item) {
  if (!item || typeof item.root !== 'string' || typeof item.path !== 'string' || !ROOTS[item.root]) throw new Error('Invalid storage item');
  const root = path.resolve(ROOTS[item.root]);
  const target = path.resolve(root, item.path);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error('Forbidden storage path');
  return target;
}

async function deleteMediaItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_MEDIA_ITEMS) throw new Error('Select 1–300 media files');
  let deletedCount = 0;
  let freedBytes = 0;
  for (const item of items) {
    const target = resolveMediaItem(item);
    const stat = await statSafe(target);
    if (!stat || !stat.isFile()) continue;
    await fs.unlink(target);
    deletedCount += 1;
    freedBytes += stat.size;
  }
  return { deletedCount, freedBytes };
}

async function getMediaThumbnail(item) {
  const target = resolveMediaItem(item);
  const stat = await statSafe(target);
  const ext = path.extname(target).toLowerCase();
  if (!stat?.isFile() || !['.heic', '.heif'].includes(ext)) throw new Error('Thumbnail is only available for HEIC images');
  // Stream a small JPEG only; the source HEIC is never rewritten or duplicated.
  const { stdout } = await execFileAsync('magick', [target, '-auto-orient', '-thumbnail', '320x320>', '-strip', 'jpeg:-'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: 15000 });
  return stdout;
}

module.exports = { getStorageReport, deleteMediaItems, getMediaThumbnail };
