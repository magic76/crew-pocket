const fs = require('node:fs');
const path = require('node:path');

function handleBuildArtifact(req, res, pathname) {
  const match = pathname.match(/^\/api\/build-artifacts\/([a-f0-9-]{36})\/(report\.json|build\.log|[A-Za-z0-9._-]+\.apk)$/);
  if (req.method !== 'GET' || !match) { res.writeHead(404); res.end(); return; }
  const root = path.join(fs.realpathSync(process.env.HOME), '.crew-pocket/builds', match[1]);
  const candidate = path.join(root, match[2]);
  let file, stat;
  try { file = fs.realpathSync(candidate); if (file !== candidate || !file.startsWith(fs.realpathSync(root) + path.sep)) throw Error('Invalid artifact'); stat = fs.statSync(file); if (!stat.isFile()) throw Error('Not a file'); }
  catch (_) { res.writeHead(404); res.end('Build artifact not found'); return; }
  const apk = match[2].endsWith('.apk');
  res.writeHead(200, { 'Content-Type': apk ? 'application/vnd.android.package-archive' : match[2].endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8', 'Content-Length': stat.size, 'Cache-Control': 'no-store', ...(apk ? { 'Content-Disposition': `attachment; filename="${match[2]}"` } : {}) });
  const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}
module.exports = { handleBuildArtifact };
