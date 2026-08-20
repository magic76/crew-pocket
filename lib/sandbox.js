const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { ROOT_DIR, parseJsonBody } = require('./config');

const SCRATCH_DIR = path.join(ROOT_DIR, 'scratch');
if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

// ⚡ One-Click Code Execution Sandbox (Python / Bash / Node.js)
async function handleRunCode(req, res) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { code, language } = body;
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No code provided' }));
  }

  const lang = (language || 'javascript').toLowerCase().trim();
  const startTs = Date.now();

  let cmd = 'node';
  let ext = '.js';

  if (lang.includes('py')) {
    cmd = 'python3';
    ext = '.py';
  } else if (lang.includes('bash') || lang.includes('sh') || lang.includes('shell')) {
    cmd = 'bash';
    ext = '.sh';
  } else {
    cmd = 'node';
    ext = '.js';
  }

  const tempFile = path.join(SCRATCH_DIR, `run_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
  
  try {
    await fsPromises.writeFile(tempFile, code, 'utf-8');

    const child = spawn(cmd, [tempFile], {
      cwd: '/data/data/com.termux/files/home',
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let stdout = '';
    let stderr = '';
    let isKilled = false;

    const timeout = setTimeout(() => {
      isKilled = true;
      try { child.kill('SIGTERM'); } catch (e) {}
    }, 15000); // 15s max execution time

    child.stdout.on('data', chunk => {
      if (stdout.length < 50000) stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      if (stderr.length < 50000) stderr += chunk.toString();
    });

    child.on('close', async (exitCode) => {
      clearTimeout(timeout);
      try { await fsPromises.unlink(tempFile); } catch (e) {}

      const duration_ms = Date.now() - startTs;
      let output = stdout.trim();
      let error = stderr.trim();

      if (isKilled) {
        error = (error ? error + '\n' : '') + '[執行逾時 (超過 15 秒已自動中止)]';
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: exitCode === 0 && !isKilled,
        output: output || (exitCode === 0 ? '(程式執行成功，無輸出內容)' : ''),
        error,
        exit_code: exitCode,
        duration_ms
      }));
    });

    child.on('error', async (err) => {
      clearTimeout(timeout);
      try { await fsPromises.unlink(tempFile); } catch (e) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        output: '',
        error: `無法啟動直譯器 (${cmd}): ${err.message}`,
        exit_code: -1,
        duration_ms: Date.now() - startTs
      }));
    });

  } catch (err) {
    try { await fsPromises.unlink(tempFile); } catch (e) {}
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
  handleRunCode
};
