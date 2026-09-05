const { spawn } = require('node:child_process');

// In-memory Quota Cache (60s TTL) to prevent repeated slow CLI calls
let cachedQuotaData = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000;

// 📊 Query AGY / Model Quota Usage
async function handleUsage(res, parsedUrl) {
  try {
    const forceRefresh = parsedUrl?.query?.refresh === '1' || parsedUrl?.query?.force === '1';
    const now = Date.now();

    // 1. Return fresh cached data if available and not forced
    if (!forceRefresh && cachedQuotaData && (now - lastFetchTime < CACHE_TTL_MS)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ...cachedQuotaData,
        cached: true,
        cacheAgeSec: Math.round((now - lastFetchTime) / 1000)
      }));
    }

    const child = spawn('agy', ['-p', '/usage'], {
      cwd: '/data/data/com.termux/files/home',
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    let isTerminated = false;

    // 30-second timeout for mobile / high-latency Google API calls
    const timeout = setTimeout(() => {
      isTerminated = true;
      try { child.kill('SIGTERM'); } catch (e) {}
    }, 30000);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      const raw = (stdout.trim() || stderr.trim());
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

      if (quotas.length > 0) {
        cachedQuotaData = {
          success: true,
          raw,
          quotas,
          updatedAt: new Date().toISOString()
        };
        lastFetchTime = Date.now();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(cachedQuotaData));
      }

      // If failed or timeout, check if we have fallback cached data
      if (cachedQuotaData) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ...cachedQuotaData,
          cached: true,
          isStale: true,
          warning: isTerminated ? '連線逾時，顯示上次快取配額' : '查詢未果，顯示上次快取配額'
        }));
      }

      let friendlyError = raw;
      if (isTerminated || raw.includes('terminated signal') || raw.includes('context deadline exceeded')) {
        friendlyError = 'Google 配額伺服器連線逾時，請稍候重試或點擊右上角重新整理。';
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        raw: friendlyError,
        quotas: []
      }));
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (cachedQuotaData) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ...cachedQuotaData, cached: true, isStale: true }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

  } catch (err) {
    if (cachedQuotaData) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...cachedQuotaData, cached: true, isStale: true }));
    }
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  handleUsage
};

