const { spawn } = require('node:child_process');

// 📊 Query AGY / Model Quota Usage
async function handleUsage(res) {
  try {
    const child = spawn('agy', ['-p', '/usage'], {
      cwd: '/data/data/com.termux/files/home',
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (e) {}
    }, 12000);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      const raw = stdout.trim() || stderr.trim();
      const lines = raw.split('\n').filter(l => l.includes('%'));
      const quotas = lines.map(line => {
        const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          const pctMatch = parts.find(p => p.includes('%'));
          const percent = pctMatch ? parseInt(pctMatch.replace('%', ''), 10) : 0;
          return {
            model: parts[0],
            type: parts[1] || 'Limit Remaining',
            percent,
            resetAt: parts[parts.length - 1]
          };
        }
        return { raw: line };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: quotas.length > 0,
        raw,
        quotas
      }));
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  handleUsage
};
