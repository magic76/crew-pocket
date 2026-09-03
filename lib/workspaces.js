const fs = require('node:fs/promises');
const path = require('node:path');

const HOME_DIR = path.resolve(process.env.HOME || '/data/data/com.termux/files/home');
const HIDDEN_OR_HEAVY_DIRS = new Set(['.cache', '.codex', '.gemini', '.npm', '.termux', 'node_modules', 'storage']);

function isWithinHome(candidate) {
  return candidate === HOME_DIR || candidate.startsWith(HOME_DIR + path.sep);
}

function displayName(candidate) {
  if (candidate === HOME_DIR) return 'Home';
  return path.basename(candidate);
}

function iconFor(candidate) {
  const name = path.basename(candidate).toLowerCase();
  if (name === 'agy-web' || name.includes('crew-pocket')) return '🧭';
  if (name.includes('crew-helper')) return '📱';
  return '📁';
}

async function resolveWorkspace(candidate) {
  const resolved = path.resolve(String(candidate || HOME_DIR));
  if (!isWithinHome(resolved)) throw new Error('工作區必須位於 Termux Home 目錄內');
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (_) {
    throw new Error('工作區目錄不存在');
  }
  if (!stat.isDirectory()) throw new Error('工作區必須是資料夾');
  return resolved;
}

async function listWorkspaces() {
  const rows = [{ id: 'home', path: HOME_DIR, label: 'Home', icon: '🏠', detail: '~' }];
  let entries = [];
  try {
    entries = await fs.readdir(HOME_DIR, { withFileTypes: true });
  } catch (_) {
    return rows;
  }

  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || HIDDEN_OR_HEAVY_DIRS.has(entry.name)) continue;
    const candidate = path.join(HOME_DIR, entry.name);
    try {
      await Promise.all([
        fs.access(path.join(candidate, '.git')).catch(() => fs.access(path.join(candidate, 'AGENTS.md'))).catch(() => fs.access(path.join(candidate, 'GEMINI.md')))
      ]);
      projects.push({
        id: entry.name,
        path: candidate,
        label: displayName(candidate),
        icon: iconFor(candidate),
        detail: `~/${entry.name}`
      });
    } catch (_) {}
  }
  return rows.concat(projects.sort((a, b) => a.label.localeCompare(b.label)));
}

module.exports = { HOME_DIR, resolveWorkspace, listWorkspaces };
