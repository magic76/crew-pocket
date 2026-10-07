const fs = require('node:fs/promises');
const path = require('node:path');

const HOME_DIR = path.resolve(process.env.HOME || '/data/data/com.termux/files/home');
const HIDDEN_OR_HEAVY_DIRS = new Set(['.cache', '.codex', '.gemini', '.npm', '.termux', 'node_modules', 'storage']);

function isWithinHome(candidate, home = HOME_DIR) {
  return candidate === home || candidate.startsWith(home + path.sep);
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
  let stat;
  let realPath;
  try {
    realPath = await fs.realpath(resolved);
    stat = await fs.stat(realPath);
  } catch (_) {
    throw new Error('工作區目錄不存在');
  }
  // Android exposes /data/data and /data/user/0 aliases. Compare real paths
  // so valid aliases work and symlinks escaping HOME are rejected.
  const realHome = await fs.realpath(HOME_DIR);
  let withinHome = isWithinHome(realPath, realHome);
  if (!withinHome) {
    // Some Android aliases are bind mounts, not symlinks, so realpath alone
    // does not unify them. Directory identity still proves the ancestry.
    const homeStat = await fs.stat(realHome);
    let ancestor = realPath;
    while (true) {
      const ancestorStat = ancestor === realPath ? stat : await fs.stat(ancestor);
      if (ancestorStat.dev === homeStat.dev && ancestorStat.ino === homeStat.ino) {
        withinHome = true;
        break;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
  if (!withinHome) throw new Error('工作區必須位於目前 Runtime 的 Home 目錄內');
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
    projects.push({
      id: entry.name,
      path: candidate,
      label: displayName(candidate),
      icon: iconFor(candidate),
      detail: `~/${entry.name}`
    });
  }
  return rows.concat(projects.sort((a, b) => a.label.localeCompare(b.label)));
}

async function createWorkspace(rawName) {
  const name = String(rawName || '').trim();
  if (!name) throw new Error('目錄名稱不可為空');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('目錄名稱僅能包含英數字、底線與連字號');
  if (HIDDEN_OR_HEAVY_DIRS.has(name) || name.startsWith('.')) throw new Error('目錄名稱受保留或不合法');

  const targetPath = path.join(HOME_DIR, name);
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      await resolveWorkspace(targetPath);
      return { id: name, path: targetPath, label: displayName(targetPath), icon: iconFor(targetPath), detail: `~/${name}`, created: false };
    }
    throw new Error('同名檔案已存在');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fs.mkdir(targetPath, { recursive: true });
  return { id: name, path: targetPath, label: displayName(targetPath), icon: iconFor(targetPath), detail: `~/${name}`, created: true };
}

module.exports = { HOME_DIR, resolveWorkspace, listWorkspaces, createWorkspace };
