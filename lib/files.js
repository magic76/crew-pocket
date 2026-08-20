const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');

const HOME_DIR = '/data/data/com.termux/files/home';

// Get icon type based on extension
function getFileMeta(filename, isDir) {
  if (isDir) return { icon: '📁', type: 'directory' };
  const ext = path.extname(filename).toLowerCase();
  
  if (['.js', '.ts', '.mjs', '.cjs'].includes(ext)) return { icon: '🟨', type: 'javascript', ext };
  if (['.py', '.pyw'].includes(ext)) return { icon: '🐍', type: 'python', ext };
  if (['.html', '.htm'].includes(ext)) return { icon: '🌐', type: 'html', ext };
  if (['.css', '.scss', '.less'].includes(ext)) return { icon: '🎨', type: 'css', ext };
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) return { icon: '⚙️', type: 'config', ext };
  if (['.md', '.markdown', '.txt', '.log'].includes(ext)) return { icon: '📝', type: 'markdown', ext };
  if (['.sh', '.bash', '.zsh'].includes(ext)) return { icon: '💻', type: 'shell', ext };
  if (['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.ico'].includes(ext)) return { icon: '🖼️', type: 'image', ext };
  if (['.zip', '.tar', '.gz', '.tgz', '.rar'].includes(ext)) return { icon: '📦', type: 'archive', ext };
  
  return { icon: '📄', type: 'file', ext };
}

// Format file size
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 📂 List directory contents under Termux $HOME
async function handleListFiles(parsedUrl, res) {
  try {
    const reqPath = parsedUrl.query.path || '';
    const safeRelPath = reqPath.replace(/^(\.\.[\/\\])+/, '').replace(/^[\\\/]+/, '');
    const resolvedPath = path.resolve(HOME_DIR, safeRelPath);

    // Security Check: Must stay within HOME_DIR
    if (!resolvedPath.startsWith(HOME_DIR)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden: Path traversal outside home directory' }));
    }

    if (!fs.existsSync(resolvedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Directory not found' }));
    }

    const stat = await fsPromises.stat(resolvedPath);
    if (!stat.isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Target path is not a directory' }));
    }

    const dirEntries = await fsPromises.readdir(resolvedPath, { withFileTypes: true });
    const entries = [];

    for (const ent of dirEntries) {
      // Hide noisy internal directories by default unless explicitly navigated into
      if (ent.name.startsWith('.') && !['.bashrc', '.profile', '.gemini'].includes(ent.name)) {
        continue;
      }

      const fullPath = path.join(resolvedPath, ent.name);
      const isDir = ent.isDirectory();
      let size = 0;
      let mtime = 0;

      try {
        const entStat = await fsPromises.stat(fullPath);
        size = entStat.size;
        mtime = entStat.mtimeMs;
      } catch (e) {}

      const meta = getFileMeta(ent.name, isDir);
      const relToHome = path.relative(HOME_DIR, fullPath);

      entries.push({
        name: ent.name,
        relPath: relToHome,
        fullPath,
        isDirectory: isDir,
        size: isDir ? 0 : size,
        sizeFormatted: isDir ? '' : formatBytes(size),
        mtime,
        icon: meta.icon,
        type: meta.type,
        ext: meta.ext || ''
      });
    }

    // Sort: Directories first, then files alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const currentRel = path.relative(HOME_DIR, resolvedPath);
    const parentRel = (resolvedPath === HOME_DIR) ? null : path.relative(HOME_DIR, path.dirname(resolvedPath));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      currentPath: currentRel,
      fullPath: resolvedPath,
      parentPath: parentRel,
      isRoot: resolvedPath === HOME_DIR,
      entries
    }));

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// 📄 Safe File Content Reader (Max 2MB Text)
async function handleReadFile(parsedUrl, res) {
  try {
    const reqPath = parsedUrl.query.path || '';
    if (!reqPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Path parameter is required' }));
    }

    const resolvedPath = path.resolve(HOME_DIR, reqPath.replace(/^[\\\/]+/, ''));

    // Security Check: Must stay within HOME_DIR
    if (!resolvedPath.startsWith(HOME_DIR)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden' }));
    }

    if (!fs.existsSync(resolvedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File not found' }));
    }

    const stat = await fsPromises.stat(resolvedPath);
    if (stat.isDirectory()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Target is a directory' }));
    }

    if (stat.size > 2 * 1024 * 1024) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File is too large to preview (> 2MB)' }));
    }

    const content = await fsPromises.readFile(resolvedPath, 'utf-8');
    const filename = path.basename(resolvedPath);
    const meta = getFileMeta(filename, false);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      name: filename,
      fullPath: resolvedPath,
      relPath: path.relative(HOME_DIR, resolvedPath),
      size: stat.size,
      sizeFormatted: formatBytes(stat.size),
      ext: meta.ext || '',
      icon: meta.icon,
      type: meta.type,
      content
    }));

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  handleListFiles,
  handleReadFile
};
