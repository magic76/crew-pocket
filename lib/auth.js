const { spawn, exec } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const HOME_DIR = process.env.HOME || '/data/data/com.termux/files/home';
const AGY_TOKEN_PATH = path.join(HOME_DIR, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');

let activeCodexDeviceSession = null;

/**
 * Check login status for all available providers (Codex, AGY)
 */
async function getAuthStatus() {
  const results = {
    codex: { loggedIn: false, message: '未檢測到登入狀態', method: 'none' },
    antigravity: { loggedIn: false, message: '憑證不存在', method: 'oauth' }
  };

  // 1. Check Codex Status
  try {
    const codexStatus = await new Promise((resolve) => {
      exec('codex login status', {
        env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0' },
        timeout: 5000
      }, (err, stdout, stderr) => {
        const out = ((stdout || '') + (stderr || '')).trim();
        const isNotLoggedIn = /not\s*logged\s*in/i.test(out) || /expired/i.test(out) || /unauthenticated/i.test(out);
        if (!isNotLoggedIn && /logged\s*in/i.test(out)) {
          resolve({ loggedIn: true, message: out, method: /api\s*key/i.test(out) ? 'api_key' : 'chatgpt' });
        } else {
          resolve({ loggedIn: false, message: out || '未登入或 Token 已過期', method: 'none' });
        }
      });
    });
    results.codex = codexStatus;
  } catch (err) {
    results.codex = { loggedIn: false, message: err.message || '查詢失敗', method: 'none' };
  }

  // 2. Check Antigravity Status
  try {
    await fs.access(AGY_TOKEN_PATH);
    const content = await fs.readFile(AGY_TOKEN_PATH, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && (parsed.token || parsed.auth_method)) {
      results.antigravity = { loggedIn: true, message: 'Google OAuth 憑證正常', method: parsed.auth_method || 'oauth' };
    } else {
      results.antigravity = { loggedIn: false, message: '憑證無效或為空', method: 'oauth' };
    }
  } catch (_) {
    results.antigravity = { loggedIn: false, message: '憑證檔案不存在，請執行 agy 登入', method: 'none' };
  }

  return results;
}

/**
 * Start a new Device Auth login session for Codex
 */
function startCodexDeviceLogin() {
  if (activeCodexDeviceSession && activeCodexDeviceSession.proc) {
    try {
      activeCodexDeviceSession.proc.kill('SIGTERM');
    } catch (_) {}
    activeCodexDeviceSession = null;
  }

  const sessionId = `dev_auth_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  return new Promise((resolve, reject) => {
    let resolved = false;
    let rawOutput = '';

    const proc = spawn('codex', ['login', '--device-auth'], {
      env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0' }
    });

    const session = {
      sessionId,
      proc,
      url: 'https://auth.openai.com/codex/device',
      userCode: '',
      status: 'pending', // 'pending' | 'completed' | 'failed' | 'timeout'
      error: null,
      createdAt: Date.now()
    };

    activeCodexDeviceSession = session;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      rawOutput += text;

      const urlMatch = rawOutput.match(/https?:\/\/[^\s\)]+/i);
      const codeMatch = rawOutput.match(/\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/i);

      if (urlMatch) session.url = urlMatch[0];
      if (codeMatch) session.userCode = codeMatch[1];

      if (session.userCode && !resolved) {
        resolved = true;
        resolve({
          sessionId,
          url: session.url,
          userCode: session.userCode,
          status: 'pending'
        });
      }
    });

    proc.stderr.on('data', (chunk) => {
      rawOutput += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        session.status = 'completed';
      } else {
        session.status = 'failed';
        session.error = `Codex 登入程序退出（Exit code: ${code}）`;
      }
      if (!resolved) {
        resolved = true;
        reject(new Error(session.error || '啟動 Device Auth 失敗'));
      }
    });

    proc.on('error', (err) => {
      session.status = 'failed';
      session.error = err.message;
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    // 10s initial detection timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill('SIGTERM'); } catch (_) {}
        session.status = 'timeout';
        reject(new Error('等待 Codex Device Auth 驗證碼超時'));
      }
    }, 10000);
  });
}

/**
 * Get status of active Codex Device login
 */
function getCodexDeviceLoginStatus(sessionId) {
  if (!activeCodexDeviceSession || activeCodexDeviceSession.sessionId !== sessionId) {
    return { status: 'not_found' };
  }
  return {
    sessionId: activeCodexDeviceSession.sessionId,
    status: activeCodexDeviceSession.status,
    url: activeCodexDeviceSession.url,
    userCode: activeCodexDeviceSession.userCode,
    error: activeCodexDeviceSession.error || null
  };
}

/**
 * Cancel active Codex Device login
 */
function cancelCodexDeviceLogin(sessionId) {
  if (activeCodexDeviceSession && (!sessionId || activeCodexDeviceSession.sessionId === sessionId)) {
    try {
      activeCodexDeviceSession.proc.kill('SIGTERM');
    } catch (_) {}
    activeCodexDeviceSession.status = 'cancelled';
    activeCodexDeviceSession = null;
    return { success: true };
  }
  return { success: false, message: '無進行中的驗證流程' };
}

/**
 * Login Codex with API Key directly
 */
async function loginCodexWithApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('請提供有效的 API Key');
  }
  return new Promise((resolve, reject) => {
    const proc = spawn('codex', ['login', '--with-api-key'], {
      env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0' }
    });

    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: 'API Key 認證成功' });
      } else {
        reject(new Error(stderr || stdout || `API Key 設定失敗 (Code: ${code})`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.stdin.write(apiKey.trim());
    proc.stdin.end();
  });
}

/**
 * Update Antigravity OAuth Token directly
 */
async function setAgyToken(tokenPayload) {
  let content = '';
  if (typeof tokenPayload === 'string') {
    content = tokenPayload.trim();
  } else if (typeof tokenPayload === 'object') {
    content = JSON.stringify(tokenPayload, null, 2);
  }
  if (!content) throw new Error('Token 內容不可為空');

  await fs.mkdir(path.dirname(AGY_TOKEN_PATH), { recursive: true });
  await fs.writeFile(AGY_TOKEN_PATH, content, { mode: 0o600 });
  return { success: true, message: 'Antigravity 憑證更新成功' };
}

module.exports = {
  getAuthStatus,
  startCodexDeviceLogin,
  getCodexDeviceLoginStatus,
  cancelCodexDeviceLogin,
  loginCodexWithApiKey,
  setAgyToken
};
