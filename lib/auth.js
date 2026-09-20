const { spawn, exec } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const HOME_DIR = process.env.HOME || '/data/data/com.termux/files/home';
const AGY_TOKEN_PATH = path.join(HOME_DIR, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(HOME_DIR, '.config');
const JEV_ENV_PATH = process.env.JEV_ENV_FILE
  ? path.resolve(process.env.JEV_ENV_FILE)
  : path.join(XDG_CONFIG_HOME, 'jev', '.env');

let activeCodexDeviceSession = null;

/**
 * Check login status for all available providers (Codex, AGY)
 */
function parseEnvValue(content, key) {
  const prefix = key + '=';
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.startsWith(prefix)) continue;
    return line.slice(prefix.length).trim();
  }
  return '';
}

async function getJevApiKey() {
  const environmentKey = String(process.env.TYPESAFE_API_KEY || '').trim();
  if (environmentKey) return environmentKey;

  try {
    const content = await fs.readFile(JEV_ENV_PATH, 'utf8');
    return parseEnvValue(content, 'TYPESAFE_API_KEY');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function getJevStatus() {
  if (String(process.env.TYPESAFE_API_KEY || '').trim()) {
    return {
      configured: true,
      source: 'environment',
      message: 'TYPESAFE_API_KEY 已由 Runtime 環境變數提供'
    };
  }

  try {
    const content = await fs.readFile(JEV_ENV_PATH, 'utf8');
    const apiKey = parseEnvValue(content, 'TYPESAFE_API_KEY');
    if (apiKey) {
      return {
        configured: true,
        source: 'config_file',
        path: JEV_ENV_PATH,
        message: 'TypeSafe API Key 已設定'
      };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return {
        configured: false,
        source: 'error',
        path: JEV_ENV_PATH,
        message: '讀取 Jev Key 設定失敗'
      };
    }
  }

  return {
    configured: false,
    source: 'none',
    path: JEV_ENV_PATH,
    message: '尚未設定 TypeSafe API Key'
  };
}

async function getAuthStatus() {
  const results = {
    antigravity: { loggedIn: false, message: '憑證不存在', method: 'oauth' },
    jev: await getJevStatus()
  };

  try {
    await fs.access(AGY_TOKEN_PATH);
    const content = await fs.readFile(AGY_TOKEN_PATH, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && (parsed.token || parsed.auth_method)) {
      results.antigravity = {
        loggedIn: true,
        message: 'Google OAuth 憑證正常',
        method: parsed.auth_method || 'oauth'
      };
    } else {
      results.antigravity = { loggedIn: false, message: '憑證無效或為空', method: 'oauth' };
    }
  } catch (_) {
    results.antigravity = {
      loggedIn: false,
      message: '憑證檔案不存在，請執行 agy 登入',
      method: 'none'
    };
  }

  return results;
}

/**
 * Start a new Login session for Codex (OAuth browser flow or Device Auth flow)
 * @param {'oauth'|'device'} mode 
 */
function startCodexLogin(mode = 'oauth') {
  if (activeCodexDeviceSession && activeCodexDeviceSession.proc) {
    try {
      if (!activeCodexDeviceSession.proc.killed) {
        activeCodexDeviceSession.proc.kill('SIGTERM');
      }
    } catch (_) {}
    activeCodexDeviceSession = null;
  }

  const sessionId = `codex_auth_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const isDeviceMode = mode === 'device';

  return new Promise((resolve, reject) => {
    let resolved = false;
    let rawOutput = '';

    const args = isDeviceMode ? ['login', '--device-auth'] : ['login'];
    const proc = spawn('codex', args, {
      env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0' }
    });

    const session = {
      sessionId,
      mode: isDeviceMode ? 'device' : 'oauth',
      proc,
      url: isDeviceMode ? 'https://auth.openai.com/codex/device' : '',
      userCode: '',
      status: 'pending', // 'pending' | 'completed' | 'failed' | 'timeout'
      error: null,
      createdAt: Date.now()
    };

    activeCodexDeviceSession = session;

    const handleChunk = (chunk) => {
      const text = chunk.toString();
      rawOutput += text;

      // Strip ANSI escape codes to ensure clean regex matching
      const cleanOutput = rawOutput.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');

      if (isDeviceMode) {
        const urlMatch = cleanOutput.match(/https?:\/\/[^\s\)\"\'\<\>]+/i);
        const codeMatch = cleanOutput.match(/\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/i) || cleanOutput.match(/([A-Z0-9]{4,6}-[A-Z0-9]{4,6})/i);

        if (urlMatch) session.url = urlMatch[0];
        if (codeMatch) session.userCode = codeMatch[1];

        if (session.userCode && !resolved) {
          resolved = true;
          resolve({
            sessionId,
            mode: 'device',
            url: session.url,
            userCode: session.userCode,
            status: 'pending'
          });
        }
      } else {
        // Standard OAuth Browser flow
        const urlMatch = cleanOutput.match(/https:\/\/auth\.openai\.com\/oauth\/authorize[^\s\)\"\'\<\>]+/i);
        if (urlMatch) {
          session.url = urlMatch[0];
          if (!resolved) {
            resolved = true;
            resolve({
              sessionId,
              mode: 'oauth',
              url: session.url,
              userCode: '',
              status: 'pending'
            });
          }
        }
      }
    };

    proc.stdout.on('data', handleChunk);
    proc.stderr.on('data', handleChunk);

    proc.on('close', (code) => {
      if (code === 0) {
        session.status = 'completed';
      } else {
        session.status = 'failed';
        session.error = `Codex 登入程序退出（Exit code: ${code}）`;
      }
      if (!resolved) {
        resolved = true;
        reject(new Error(session.error || '啟動登入授權失敗'));
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

    // 20s detection timeout for initial URL / Code generation
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { proc.kill('SIGTERM'); } catch (_) {}
        session.status = 'timeout';
        reject(new Error('等待 Codex 授權連結產生逾時（請重試）'));
      }
    }, 20000);
  });
}

function startCodexDeviceLogin() {
  return startCodexLogin('device');
}

/**
 * Get status of active Codex Device / OAuth login
 */
function getCodexDeviceLoginStatus(sessionId) {
  if (!activeCodexDeviceSession || activeCodexDeviceSession.sessionId !== sessionId) {
    return { status: 'not_found' };
  }
  return {
    sessionId: activeCodexDeviceSession.sessionId,
    mode: activeCodexDeviceSession.mode || 'oauth',
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
      if (activeCodexDeviceSession.proc && !activeCodexDeviceSession.proc.killed) {
        activeCodexDeviceSession.proc.kill('SIGTERM');
      }
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
async function setJevApiKey(apiKey) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) throw new Error('請提供 TypeSafe API Key');
  if (/[\r\n]/.test(key)) throw new Error('TypeSafe API Key 格式無效');

  await fs.mkdir(path.dirname(JEV_ENV_PATH), { recursive: true, mode: 0o700 });

  let existing = '';
  try {
    existing = await fs.readFile(JEV_ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const lines = String(existing || '').split(/\r?\n/);
  const next = [];
  let replaced = false;
  for (const line of lines) {
    if (/^\s*TYPESAFE_API_KEY\s*=/.test(line)) {
      if (!replaced) {
        next.push(`TYPESAFE_API_KEY=${key}`);
        replaced = true;
      }
      continue;
    }
    if (line !== '' || next.length > 0) next.push(line);
  }
  if (!replaced) next.push(`TYPESAFE_API_KEY=${key}`);

  while (next.length && next[next.length - 1] === '') next.pop();
  const tempPath = `${JEV_ENV_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, next.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, JEV_ENV_PATH);
  await fs.chmod(JEV_ENV_PATH, 0o600);

  return {
    success: true,
    configured: true,
    path: JEV_ENV_PATH,
    message: 'TypeSafe Jev Key 已儲存'
  };
}

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
  startCodexLogin,
  startCodexDeviceLogin,
  getCodexDeviceLoginStatus,
  cancelCodexDeviceLogin,
  loginCodexWithApiKey,
  setAgyToken,
  setJevApiKey,
  getJevStatus,
  getJevApiKey
};
