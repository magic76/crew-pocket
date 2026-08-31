const fsPromises = require('node:fs/promises');
const path = require('node:path');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function toPublicUrl(relativePath) {
  return `/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

async function collectPublicAssets(publicDir) {
  const assets = [];
  const rootDir = path.join(publicDir, 'extra');

  async function walk(currentDir) {
    const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      // This launcher must not recursively preview itself.
      if (!['.html', '.htm'].includes(ext) || entry.name === 'assets.html') continue;

      const stat = await fsPromises.stat(fullPath);
      const relativePath = path.relative(publicDir, fullPath);
      assets.push({
        name: entry.name,
        path: relativePath.split(path.sep).join('/'),
        url: toPublicUrl(relativePath),
        ext: ext || '無副檔名',
        size: stat.size,
        sizeFormatted: formatBytes(stat.size),
        updatedAt: stat.mtimeMs
      });
    }
  }

  try {
    await walk(rootDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return assets.sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path));
}

async function handleListPublicAssets(publicDir, res) {
  try {
    const assets = await collectPublicAssets(publicDir);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: true, scannedAt: Date.now(), count: assets.length, assets }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

module.exports = { handleListPublicAssets };
