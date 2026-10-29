const { sessionManager } = require('../session');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const { getAuthStatus } = require('../auth');
const { AVAILABLE_MODELS } = require('../config');
const { handleListConversations, handleGetHistory, handleDeleteConversation, handleRewindConversation } = require('../history');
const { handleRenameConversation } = require('../title');
const { handleCompact } = require('../compact');
const { runtimeConfig, spawnAgy, execAgy, isAgyAvailable } = require('../runtime/agy-transport');

const activeAgyLoginCaptureDirs = new Set();
process.once('exit', () => {
  for (const directory of activeAgyLoginCaptureDirs) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {}
  }
});

const metadata = {
  id: 'antigravity',
  label: 'Antigravity',
  shortLabel: 'AGY',
  icon: '✨',
  storagePrefix: 'agy',
  badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  greeting: '你好！已為你開啟新對話。有什麼可以幫你的？',
  capabilities: {
    models: true,
    history: true,
    contextUsage: true,
    rename: true,
    delete: true,
    rewind: true,
    compact: 'checkpoint',
    usage: { mode: 'endpoint', endpoint: '/api/usage' },
    autoTitle: false
  }
};

function callLegacyHandler(handler, { query = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let settled = false;
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload = '') {
        if (settled) return;
        settled = true;
        let data = payload;
        try { data = payload ? JSON.parse(payload) : {}; } catch (_) {}
        if (statusCode >= 400) {
          const error = new Error(data?.error || `Antigravity request failed (${statusCode})`);
          error.statusCode = statusCode;
          reject(error);
        } else resolve(data || {});
      }
    };
    const req = body === undefined ? null : Readable.from([JSON.stringify(body)]);
    try {
      Promise.resolve(req ? handler(req, res) : handler({ query }, res)).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function awaitConversationId(session) {
  if (session.conversationId) return session.conversationId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      session.emitter.off('event', onEvent);
      session.process.off('close', onClose);
      session.process.off('error', onError);
      if (error) reject(error);
      else resolve(session.conversationId);
    };
    const onEvent = item => {
      if (item.event === 'init' && item.conversation_id) finish();
    };
    const onClose = code => finish(new Error(
      session.authError || 'AGY closed before session initialization (exit ' + code + ')'));
    const onError = error => finish(error);
    const timeout = setTimeout(() => finish(new Error('AGY initialization timed out; no conversation ID received')), 20000);
    session.emitter.on('event', onEvent);
    session.process.on('close', onClose);
    session.process.on('error', onError);
    if (session.conversationId) finish();
    else if (session.process.killed) onClose(null);
  });
}

async function startTurn({ conversationId, model, effort, prompt, workspace, onEvent, onAbort }) {
  const session = await sessionManager.getOrCreateSession(conversationId, model, effort, workspace);
  session.isBusy = true;
  sessionManager.resetIdleTimer(session);
  try {
    // Settings, Role routing and history need the native ID before session_started.
    await awaitConversationId(session);
  } catch (error) {
    session.isBusy = false;
    // Do not leave an uninitialized standby process occupying the pool.
    sessionManager.closeSession(session.conversationId || '__standby__');
    throw error;
  }
  let fullResponse = '';
  let finished = false;

  onEvent({
    type: 'session_started',
    conversationId: session.conversationId,
    model: session.model,
    effort: session.effort
  });

  const cleanup = () => {
    if (finished) return;
    finished = true;
    session.isBusy = false;
    session.emitter.removeListener('event', handleEvent);
    session.emitter.removeListener('raw', handleRaw);
    if (session.process) session.process.removeListener('close', handleClose);
    sessionManager.resetIdleTimer(session);
  };

  const handleEvent = (item) => {
    if (item.event === 'step_update' && item.step_update) {
      const update = item.step_update;
      if (update.step_type === 'agent_response' && update.text_delta) {
        fullResponse += update.text_delta;
        onEvent({ type: 'text_delta', delta: update.text_delta, accumulated: fullResponse });
      } else if (update.step_type === 'thought' || update.thinking_delta || update.thinking) {
        const delta = update.thinking_delta || update.thinking || update.text || '';
        if (delta) onEvent({ type: 'reasoning_delta', delta });
      } else if (update.step_type === 'tool') {
        const toolInfo = update.tool_info || {};
        onEvent({
          type: 'tool',
          state: update.state,
          name: update.tool_name,
          toolId: update.tool_id || update.tool_call_id || update.id || toolInfo.tool_id || null,
          toolGroupId: update.tool_group_id || toolInfo.tool_group_id || null,
          info: toolInfo,
          durationSeconds: update.duration_seconds
        });
      }
      return;
    }

    if (item.event === 'result' && item.result) {
      if (item.result.conversation_id) session.conversationId = item.result.conversation_id;
      const nativeStatus = String(item.result.status || '').toUpperCase();
      if (nativeStatus === 'ERROR' || nativeStatus === 'FAILED') {
        onEvent({
          type: 'error', terminal: true,
          message: String(item.result.error || item.result.message || 'AGY execution failed'),
          status: 'failed', conversationId: session.conversationId
        });
        cleanup();
        return;
      }
      if (item.result.thinking) {
        onEvent({ type: 'reasoning_complete', thinking: item.result.thinking });
      }
      if (item.result.response) fullResponse = item.result.response;
      onEvent({
        type: 'turn_completed',
        response: fullResponse,
        conversationId: session.conversationId,
        status: item.result.status
      });
      cleanup();
    }
  };

  const handleRaw = (line) => {
    if (line && line.trim()) console.log(`[Resident agy stdout note] ${line.trim()}`);
  };

  const handleClose = (code) => {
    if (!finished) {
      let message;
      if (session.authError) {
        message = 'AGY 登入已過期，請在 Termux 互動執行 agy 完成 Google 授權後再試。';
      } else if (code === null) {
        message = '後台核心程序已安全休眠（閒置節電或系統回收資源），已自動重連，請直接再次發送訊息。';
      } else {
        message = `agy process crashed or closed with code ${code}`;
      }
      onEvent({ type: 'error', message, terminal: true });
    }
    cleanup();
  };

  session.emitter.on('event', handleEvent);
  session.emitter.on('raw', handleRaw);
  if (session.process) session.process.on('close', handleClose);

  onAbort(() => {
    if (!finished && session.isBusy) sessionManager.closeSession(session.conversationId);
    cleanup();
  });

  const payload = {
    event: 'user',
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] }
  };
  session.process.stdin.write(`${JSON.stringify(payload)}\n`);
  return { conversationId: session.conversationId, cleanup };
}


let activeLogin = null;

function agyLoginSnapshot() {
  if (!activeLogin) return { status: 'idle' };
  const session = activeLogin;
  const diagnostic = session.codeSubmissionAt ? {
    elapsedSeconds: Math.max(0, Math.min(86400, Math.floor((Date.now() - session.codeSubmissionAt) / 1000))),
    postSubmitOutputReceived: session.postSubmissionOutputBytes > 0,
    postSubmitOutputBytes: Math.max(0, Math.min(1000000, session.postSubmissionOutputBytes || 0)),
    submittedCodeLength: Math.max(0, Math.min(4096, session.submittedCodeLength || 0)),
    responseMarker: session.responseMarker || 'none',
    processState: !session.process ? 'unknown'
      : (session.process.exitCode !== null || session.process.signalCode) ? 'exited'
      : session.process.killed ? 'terminating' : 'running',
    credentialState: session.credentialState || 'unknown'
  } : undefined;
  return {
    sessionId: session.sessionId,
    status: session.status,
    url: session.url || '',
    error: session.error || '',
    output: session.output.slice(-3000),
    diagnostic
  };
}

function parseAgyAuthorizationUrl(candidate) {
  const value = String(candidate || '').trim().replace(/[),.;]+$/, '');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.username || url.password) {
      return { url: '', invalid: false };
    }
    if (!/\/o\/oauth2(?:\/|$)/i.test(url.pathname)) return { url: '', invalid: false };
    const required = ['response_type', 'client_id', 'redirect_uri', 'scope'];
    const valid = url.searchParams.get('response_type') === 'code'
      && required.every(name => Boolean(url.searchParams.get(name)));
    return valid
      ? { url: url.toString().slice(0, 4096), invalid: false }
      : { url: '', invalid: true };
  } catch (_) {
    return { url: '', invalid: false };
  }
}

function recordAgyAuthorizationUrl(session, candidate) {
  const parsed = parseAgyAuthorizationUrl(candidate);
  if (parsed.url) {
    session.url = parsed.url;
    session.status = 'awaiting_code';
    session.invalidAuthorizationUrl = false;
    return;
  }
  if (parsed.invalid) session.invalidAuthorizationUrl = true;
}

function cleanAgyLoginTerminalText(text) {
  return String(text || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '\n');
}

function hasAgyAuthorizationCodePrompt(text) {
  const lines = cleanAgyLoginTerminalText(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-12);
  return lines.some(line => (
    /^(?:or,\s*)?(?:paste|enter|provide)\s+(?:the\s+)?(?:authorization|verification)\s+code(?:\s+(?:here|below))?(?:\s+and\s+press\s+enter)?\s*[:?.-]*$/i.test(line)
    || /^if you aren't automatically redirected,\s*(?:paste|enter)\s+the\s+authorization\s+code\s+(?:here|below)\s*[:?.-]*$/i.test(line)
  ));
}

function inspectAgyLoginOutput(session, text) {
  if (!session || activeLogin !== session || ['completed', 'failed', 'cancelled'].includes(session.status)) return;
  const chunkText = String(text);
  session.outputBytes += Buffer.byteLength(chunkText, 'utf8');
  session.lastOutputAt = Date.now();
  session.rawOutput = (session.rawOutput + chunkText).slice(-16000);

  // OSC 8 hyperlinks contain the URL inside terminal control bytes. Check the raw
  // stream before stripping those bytes, and don't require the OSC close marker.
  const rawUrlMatch = session.rawOutput.match(/https:\/\/[^\s<>"'\u001b\u0007]+/i);
  if (rawUrlMatch && !session.url) recordAgyAuthorizationUrl(session, rawUrlMatch[0]);

  const oscLinkMatch = session.rawOutput.match(/\u001b\]8;[^;]*;(https:\/\/[^\u0007\u001b]*)(?:\u0007|\u001b\\)/i);
  if (oscLinkMatch && !session.url) recordAgyAuthorizationUrl(session, oscLinkMatch[1]);

  const cleanText = cleanAgyLoginTerminalText(session.rawOutput);
  session.output = cleanText.slice(-12000);

  const urlMatch = session.output.match(/https:\/\/[^\s<>"']+/i);
  if (urlMatch && !session.url) recordAgyAuthorizationUrl(session, urlMatch[0]);

  if (session.codeSubmissionActive) {
    session.postSubmissionRawOutput = (session.postSubmissionRawOutput + chunkText).slice(-4000);
    session.postSubmissionOutputBytes += Buffer.byteLength(chunkText, 'utf8');
    const postSubmissionText = cleanAgyLoginTerminalText(session.postSubmissionRawOutput);
    if (/invalid state parameter/i.test(postSubmissionText)) {
      session.responseMarker = 'invalid_state';
      finishAgyLogin(session, 'failed', 'Google 授權回呼與目前登入工作階段不符，請重新啟動登入並使用新授權頁的驗證碼。');
      return;
    }
    if (/(?:failed to exchange authorization code for token|invalid[_ ]grant|authorization code.{0,30}(?:invalid|expired))/i.test(postSubmissionText)) {
      session.responseMarker = 'exchange_rejected';
      finishAgyLogin(session, 'failed', 'Google 未接受這個授權碼，請重新啟動登入並使用新授權頁的驗證碼。');
      return;
    }
    if (/successfully exchanged authorization code for token/i.test(postSubmissionText)) {
      session.responseMarker = 'exchange_succeeded_message';
    }
    if (session.url && hasAgyAuthorizationCodePrompt(postSubmissionText)) {
      session.responseMarker = 'prompt_repeated';
      session.status = 'awaiting_code';
      session.error = 'AGY 再次要求授權碼，這次登入尚未完成；請重新啟動登入並使用新授權頁的驗證碼。';
      session.codeSubmissionActive = false;
      session.postSubmissionRawOutput = '';
    }
  }

  if (!session.url && /select\s+login\s+method\s*:?/i.test(session.output)) {
    session.status = 'awaiting_choice';
    if (session.startupTimeout) clearTimeout(session.startupTimeout);
    session.startupTimeout = null;
  }
}

function spawnAgyLoginTerminal({ cwd, env }) {
  const config = runtimeConfig(env);
  const command = config.type === 'node-script' && config.entry
    ? [process.execPath, config.entry]
    : ['agy'];
  const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
  const commandLine = `stty cols 2048 rows 40 -echo; exec ${command.map(shellQuote).join(' ')}`;
  const args = [
    '--quiet', '--return', '--echo', 'never', '--command', commandLine, '/dev/null'
  ];
  return spawn('script', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
}

function createAgyLoginUrlCapture(env) {
  const prefix = env.PREFIX || '/data/data/com.termux/files/usr';
  const shellPath = path.join(prefix, 'bin', 'sh');
  if (!fs.existsSync(shellPath)) return null;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-pocket-agy-login-'));
  activeAgyLoginCaptureDirs.add(directory);
  const captureFile = path.join(directory, 'url');
  const wrapperPath = path.join(directory, 'termux-open-url');
  const wrapper = [
    `#!${shellPath}`,
    'for arg do',
    '  case "$arg" in',
    '    https://*) printf \'%s\' "$arg" > "$CREW_AGY_LOGIN_URL_FILE"; break ;;',
    '  esac',
    'done',
    'exit 0',
    ''
  ].join('\n');

  try {
    fs.writeFileSync(captureFile, '', { mode: 0o600 });
    fs.writeFileSync(wrapperPath, wrapper, { mode: 0o700 });
    fs.chmodSync(wrapperPath, 0o700);
    return { directory, captureFile, wrapperPath };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    activeAgyLoginCaptureDirs.delete(directory);
    throw error;
  }
}

function readCapturedAgyLoginUrl(session) {
  if (!session || activeLogin !== session || !session.captureFile) return;
  try {
    const captured = fs.readFileSync(session.captureFile, 'utf8').trim();
    if (captured && captured !== session.lastCapturedUrl) {
      session.lastCapturedUrl = captured;
      inspectAgyLoginOutput(session, captured);
    }
  } catch (_) {}
}

function cleanupAgyLoginUrlCapture(session) {
  if (session.capturePoll) clearInterval(session.capturePoll);
  session.capturePoll = null;
  if (session.captureDir) {
    fs.rmSync(session.captureDir, { recursive: true, force: true });
    activeAgyLoginCaptureDirs.delete(session.captureDir);
  }
  session.captureDir = null;
  session.captureFile = null;
}

function finishAgyLogin(session, status, error = '') {
  if (activeLogin !== session || ['completed', 'failed', 'cancelled'].includes(session.status)) return;
  session.status = status;
  session.error = error;
  if (session.startupTimeout) clearTimeout(session.startupTimeout);
  session.startupTimeout = null;
  if (['completed', 'failed', 'cancelled'].includes(status)) {
    try { session.process?.kill('SIGTERM'); } catch (_) {}
  }
  cleanupAgyLoginUrlCapture(session);
}

function armAgyLoginStartupTimeout(session) {
  if (session.startupTimeout) clearTimeout(session.startupTimeout);
  session.startupTimeout = setTimeout(() => {
    readCapturedAgyLoginUrl(session);
    if (activeLogin !== session || session.url || !['starting', 'awaiting_code'].includes(session.status)) return;
    const reason = session.invalidAuthorizationUrl
      ? 'AGY 輸出的 Google 授權網址不完整，缺少 response_type=code 或必要 OAuth 參數。'
      : session.outputBytes === 0
      ? 'AGY 已啟動，但沒有收到終端輸出。'
      : /authorization code|paste.*code|enter.*code/i.test(session.output)
        ? 'AGY 顯示了驗證提示，但沒有提供可開啟的 Google 授權連結。'
        : 'AGY 有輸出，但沒有辨識到 Google 授權連結。';
    finishAgyLogin(session, 'failed', `${reason} 請確認 AGY 登入程序正常後重試。`);
  }, 30000);
}

async function verifyAgyLoginCredentials(session) {
  const deadline = Date.now() + 120000;
  let latestAuthStatus = null;
  while (activeLogin === session && session.status === 'verifying' && Date.now() < deadline) {
    try {
      latestAuthStatus = await getAuthStatus();
      const auth = latestAuthStatus.antigravity;
      session.credentialState = auth?.loggedIn ? 'valid'
        : auth?.method === 'invalid' ? 'invalid'
        : auth?.method === 'none' ? 'missing'
        : auth?.method === 'unreadable' ? 'unreadable' : 'unknown';
      if (latestAuthStatus.antigravity?.loggedIn) {
        if (session.responseMarker === 'none') session.responseMarker = 'credential_created';
        finishAgyLogin(session, 'completed');
        return;
      }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (activeLogin === session && session.status === 'verifying') {
    const auth = latestAuthStatus?.antigravity;
    if (session.responseMarker === 'none') {
      session.responseMarker = session.postSubmissionOutputBytes > 0 ? 'unclassified_output' : 'no_output';
    }
    const message = auth?.method === 'invalid'
      ? 'AGY 沒有完成授權碼交換：憑證檔格式無效。請重新啟動登入並使用新授權頁的驗證碼。'
      : 'Google 授權後仍未偵測到有效憑證，請重新啟動登入。';
    finishAgyLogin(session, 'failed', message);
  }
}

function startLogin() {
  if (activeLogin && ['starting', 'awaiting_choice', 'awaiting_code', 'verifying'].includes(activeLogin.status)) {
    return agyLoginSnapshot();
  }
  if (!isAgyAvailable()) {
    throw new Error('Embedded Antigravity runtime is not available');
  }

  const sessionId = `agy_auth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const env = {
    ...process.env,
    SSH_CONNECTION: process.env.SSH_CONNECTION || 'crew-pocket 127.0.0.1 127.0.0.1 22',
    TERM: 'dumb',
    NO_COLOR: '1'
  };
  const capture = createAgyLoginUrlCapture(env);
  const loginEnv = capture ? {
    ...env,
    PATH: `${capture.directory}:${env.PATH || ''}`,
    CREW_AGY_LOGIN_URL_FILE: capture.captureFile
  } : env;
  let child;
  try {
    child = spawnAgyLoginTerminal({ cwd: process.env.HOME || process.cwd(), env: loginEnv });
  } catch (error) {
    if (capture) {
      fs.rmSync(capture.directory, { recursive: true, force: true });
      activeAgyLoginCaptureDirs.delete(capture.directory);
    }
    throw error;
  }

  const session = activeLogin = {
    sessionId,
    process: child,
    status: 'starting',
    url: '',
    error: '',
    output: '',
    rawOutput: '',
    outputBytes: 0,
    lastOutputAt: 0,
    invalidAuthorizationUrl: false,
    codeSubmissionActive: false,
    postSubmissionRawOutput: '',
    codeSubmissionAt: 0,
    postSubmissionOutputBytes: 0,
    responseMarker: 'none',
    credentialState: 'unknown',
    captureDir: capture?.directory || null,
    captureFile: capture?.captureFile || null,
    capturePoll: null,
    lastCapturedUrl: '',
    startupTimeout: null
  };

  if (session.captureFile) {
    session.capturePoll = setInterval(() => readCapturedAgyLoginUrl(session), 200);
    session.capturePoll.unref?.();
    readCapturedAgyLoginUrl(session);
  }

  child.stdout.on('data', chunk => inspectAgyLoginOutput(session, chunk.toString('utf8')));
  child.stderr.on('data', chunk => inspectAgyLoginOutput(session, chunk.toString('utf8')));
  child.once('error', error => {
    if (activeLogin !== session) return;
    finishAgyLogin(session, 'failed', `無法啟動 AGY 互動登入：${error.message}`);
  });
  child.once('close', code => {
    if (activeLogin !== session || ['completed', 'cancelled', 'failed'].includes(session.status)) return;
    if (session.status === 'verifying') {
      setTimeout(async () => {
        if (activeLogin !== session || session.status !== 'verifying') return;
        let authStatus = null;
        try { authStatus = await getAuthStatus(); } catch (_) {}
        if (activeLogin !== session || session.status !== 'verifying') return;
        const auth = authStatus?.antigravity;
        session.credentialState = auth?.loggedIn ? 'valid'
          : auth?.method === 'invalid' ? 'invalid'
          : auth?.method === 'none' ? 'missing'
          : auth?.method === 'unreadable' ? 'unreadable' : 'unknown';
        if (authStatus?.antigravity?.loggedIn) {
          if (session.responseMarker === 'none') session.responseMarker = 'credential_created';
          finishAgyLogin(session, 'completed');
          return;
        }
        if (session.responseMarker === 'none') {
          session.responseMarker = session.postSubmissionOutputBytes > 0 ? 'unclassified_output' : 'no_output';
        }
        const message = authStatus?.antigravity?.method === 'invalid'
          ? 'AGY 登入程序已結束，但沒有完成授權碼交換；憑證檔格式無效。請重新啟動登入並使用新授權頁的驗證碼。'
          : `AGY 登入程序已結束（退出碼 ${code}），但沒有建立有效憑證。請重新啟動登入。`;
        finishAgyLogin(session, 'failed', message);
      }, 1000);
      return;
    }
    finishAgyLogin(session, 'failed', session.url
      ? `AGY 登入程序提前結束（退出碼 ${code}）。`
      : `AGY 尚未產生 Google 授權連結就退出（退出碼 ${code}）。`);
  });

  armAgyLoginStartupTimeout(session);

  return agyLoginSnapshot();
}

function sendLoginMenuInput(sessionId, action) {
  const session = activeLogin;
  if (!session || session.sessionId !== sessionId) throw new Error('AGY login session not found');
  if (session.status !== 'awaiting_choice') throw new Error('AGY is not waiting for a login method selection');
  if (!session.process || session.process.killed || session.process.exitCode !== null || session.process.signalCode || !session.process.stdin?.writable) {
    throw new Error('AGY login process is no longer running');
  }

  const inputs = { up: '\u001b[A', down: '\u001b[B', select: '\r' };
  if (!Object.prototype.hasOwnProperty.call(inputs, action)) throw new Error('Invalid AGY login menu action');
  if (action === 'select') {
    session.status = 'starting';
    session.error = '';
    session.rawOutput = '';
    session.output = '';
    armAgyLoginStartupTimeout(session);
  }
  session.process.stdin.write(inputs[action]);
  return agyLoginSnapshot();
}

function submitLoginCode(sessionId, code) {
  const session = activeLogin;
  if (!session || session.sessionId !== sessionId) {
    throw new Error('AGY login session not found');
  }
  if (session.status !== 'awaiting_code') {
    throw new Error('AGY login session is not ready for an authorization code');
  }
  const value = String(code || '').replace(/\s+/gu, '');
  if (!value) throw new Error('Authorization code is required');
  if (value.length > 4096) throw new Error('Authorization code is too long');
  if (!session.process || session.process.killed || session.process.exitCode !== null || session.process.signalCode || !session.process.stdin?.writable) {
    throw new Error('AGY login process is no longer running');
  }

  session.status = 'verifying';
  session.error = '';
  session.codeSubmissionActive = true;
  session.postSubmissionRawOutput = '';
  session.codeSubmissionAt = Date.now();
  session.postSubmissionOutputBytes = 0;
  session.submittedCodeLength = value.length;
  session.responseMarker = 'none';
  session.credentialState = 'unknown';
  if (session.startupTimeout) clearTimeout(session.startupTimeout);
  session.startupTimeout = null;
  try {
    session.process.stdin.write(value + '\n');
  } catch (error) {
    session.status = 'awaiting_code';
    session.codeSubmissionActive = false;
    throw error;
  }
  verifyAgyLoginCredentials(session);
  return agyLoginSnapshot();
}

function cancelLogin(sessionId) {
  if (!activeLogin || (sessionId && activeLogin.sessionId !== sessionId)) {
    return { success: false, status: 'idle' };
  }
  const session = activeLogin;
  finishAgyLogin(session, 'cancelled');
  return { success: true, status: 'cancelled' };
}

let cachedDynamicModels = null;
let lastModelDiscoveryAt = 0;
let modelDiscoveryPromise = null;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

function staticAgyModels() {
  return AVAILABLE_MODELS.filter(model => (model.provider || 'antigravity') === 'antigravity');
}

function refreshAgyModels() {
  if (modelDiscoveryPromise) return modelDiscoveryPromise;
  const now = Date.now();
  const staticModels = staticAgyModels();
  const knownIds = new Set(staticModels.map(m => m.id));
  modelDiscoveryPromise = (async () => {
    const { stdout: output } = await execAgy(['models'], { timeout: 25000 });

    const discovered = [...staticModels];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes('Fetching available models')) continue;
      const parts = trimmed.split(/\s+/);
      const rawId = parts[0];
      if (!rawId) continue;

      // Base model ID (strip -low, -medium, -high for display)
      const baseId = rawId.replace(/-(?:low|medium|high)$/, '');
      if (knownIds.has(baseId)) continue;
      knownIds.add(baseId);

      const displayName = parts.slice(1).join(' ').replace(/\s*\((?:Low|Medium|High)\)$/i, '') || baseId;
      discovered.unshift({
        id: baseId,
        provider: 'antigravity',
        name: displayName,
        desc: '雲端最新同步模型',
        icon: baseId.includes('flash') ? '⚡' : (baseId.includes('pro') ? '🔵' : '✨'),
        badge: '最新',
        badgeColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40'
      });
    }

    cachedDynamicModels = discovered;
    lastModelDiscoveryAt = now;
    return discovered;
  })().catch(err => {
    console.warn('[Antigravity Provider] Dynamic model discovery error, falling back to static config:', err.message);
    // Keep a negative result cached for the same TTL as a successful lookup.
    // A broken/absent `agy models` command should not be spawned on every app
    // boot or model-catalog request while the static picker is already usable.
    cachedDynamicModels = staticModels;
    lastModelDiscoveryAt = Date.now();
    return cachedDynamicModels;
  }).finally(() => { modelDiscoveryPromise = null; });
  return modelDiscoveryPromise;
}

async function discoverAgyModels() {
  const now = Date.now();
  if (cachedDynamicModels && (now - lastModelDiscoveryAt < MODEL_CACHE_TTL_MS)) return cachedDynamicModels;
  refreshAgyModels();
  return cachedDynamicModels || staticAgyModels();
}

module.exports = {
  id: 'antigravity',
  metadata,
  fallbackModels: staticAgyModels(),
  startTurn,
  async listModels() {
    return discoverAgyModels();
  },
  async listConversations() {
    const data = await new Promise((resolve, reject) => {
      let statusCode = 200;
      const res = {
        writeHead(code) { statusCode = code; },
        end(payload = '') {
          let parsed;
          try { parsed = payload ? JSON.parse(payload) : {}; } catch (err) { return reject(err); }
          if (statusCode >= 400) return reject(new Error(parsed.error || 'Failed to list Antigravity conversations'));
          resolve(parsed);
        }
      };
      Promise.resolve(handleListConversations(res)).catch(reject);
    });
    return (data.conversations || []).map(conversation => ({ ...conversation, provider: 'antigravity' }));
  },
  async getHistory(conversationId) {
    const history = await callLegacyHandler(handleGetHistory, { query: { id: conversationId } });
    return { ...history, provider: 'antigravity' };
  },
  async deleteConversation(conversationId) {
    await callLegacyHandler(handleDeleteConversation, { query: { id: conversationId } });
    return { localDataDeleted: true, storageFreedBytes: null };
  },
  async rewindConversation(conversationId, userTurnIndex) {
    const data = await callLegacyHandler(handleRewindConversation, {
      body: { conversation_id: conversationId, user_turn_index: userTurnIndex }
    });
    return { conversationId: data.conversation_id || conversationId, removedTurns: null };
  },
  async renameConversation(conversationId, title) {
    return callLegacyHandler(handleRenameConversation, { body: { conversation_id: conversationId, title } });
  },
  async compactConversation(conversationId, { focus, mode, locale } = {}) {
    return callLegacyHandler(handleCompact, {
      body: { conversation_id: conversationId, focus, mode, locale }
    });
  },
  getStatus(conversationId) {
    const session = sessionManager.sessions.get(conversationId);
    return { conversation_id: conversationId, isBusy: Boolean(session && session.isBusy) };
  },
  isAvailable() {
    return isAgyAvailable();
  },
  startLogin,
  getLoginStatus(sessionId) {
    if (!activeLogin || (sessionId && activeLogin.sessionId !== sessionId)) {
      return { status: 'idle' };
    }
    return agyLoginSnapshot();
  },
  submitLoginCode,
  sendLoginMenuInput,
  cancelLogin,
  stop() { sessionManager.closeActiveSession(); },
  prewarm(model, effort, workspace) { return sessionManager.prewarm(model, effort, workspace); }
};
