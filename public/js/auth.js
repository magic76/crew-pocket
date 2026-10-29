// 🔐 Provider Authentication & Login Manager (Codex Device Auth + AGY Token)
let activeAuthPollInterval = null;
let currentAuthSessionId = null;
let activeAgyLoginPollTimeout = null;
let currentAgyLoginSessionId = null;
let agyLoginPollSessionId = null;
let agyLoginResumePromise = null;
let agyLoginMenuInputPending = false;

function isAuthErrorMessage(msg = '') {
  if (!msg || typeof msg !== 'string') return false;
  return /auth|unauthorized|unauthenticated|login|not logged in|token expired|token is invalid|re-authenticate|chatgpt.*expired/i.test(msg);
}

function openAuthModal() {
  const authModal = document.getElementById('auth-modal');
  const toolsMenuDropdown = document.getElementById('tools-menu-dropdown');
  if (toolsMenuDropdown) toolsMenuDropdown.classList.add('hidden');
  if (!authModal) return;
  authModal.classList.remove('opacity-0', 'pointer-events-none');
  if (typeof window.haptic === 'function') window.haptic('light');
  refreshAuthStatus();
  refreshProviderRuntime();
  resumeAgyLoginSession();
}

function closeAuthModal() {
  const authModal = document.getElementById('auth-modal');
  if (!authModal) return;
  authModal.classList.add('opacity-0', 'pointer-events-none');
  stopDeviceAuthPolling();
  stopAgyLoginPolling();
}

async function refreshProviderRuntime() {
  const codexEl = document.getElementById('provider-version-codex');
  const agyEl = document.getElementById('provider-version-antigravity');
  const statusEl = document.getElementById('provider-update-status');

  try {
    const res = await fetch('/api/runtime/providers');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '無法取得 Provider runtime 狀態');

    const codex = data.providers?.codex;
    const agy = data.providers?.antigravity;

    if (codexEl) {
      codexEl.textContent = codex?.installed
        ? (codex.version || '已安裝')
        : '未安裝';
    }
    if (agyEl) {
      agyEl.textContent = agy?.installed
        ? (agy.version || '已安裝')
        : '未安裝';
    }
    if (statusEl && !statusEl.dataset.busy) {
      statusEl.classList.add('hidden');
      statusEl.textContent = '';
    }
  } catch (err) {
    if (codexEl) codexEl.textContent = '讀取失敗';
    if (agyEl) agyEl.textContent = '讀取失敗';
    if (statusEl && !statusEl.dataset.busy) {
      statusEl.classList.remove('hidden');
      statusEl.textContent = 'Provider runtime 狀態讀取失敗：' + err.message;
    }
  }
}

async function updateRuntimeProvider(provider) {
  const id = provider === 'antigravity' ? 'antigravity' : 'codex';
  const button = document.getElementById('provider-update-' + id);
  const statusEl = document.getElementById('provider-update-status');
  const label = id === 'codex' ? 'Codex' : 'Antigravity';

  if (!confirm('要更新 ' + label + ' 嗎？更新期間該 Provider 的進行中工作會停止。')) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = '更新中...';
  }
  if (statusEl) {
    statusEl.dataset.busy = '1';
    statusEl.classList.remove('hidden');
    statusEl.className = 'text-[10px] leading-relaxed rounded-lg px-2.5 py-2 bg-amber-950/40 text-amber-300 border border-amber-500/30';
    statusEl.textContent = '正在更新 ' + label + '，請勿關閉 Crew Pocket...';
  }

  try {
    const res = await fetch('/api/runtime/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: id })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.details || data.error || '更新失敗');
    }

    if (statusEl) {
      statusEl.className = 'text-[10px] leading-relaxed rounded-lg px-2.5 py-2 bg-emerald-950/40 text-emerald-300 border border-emerald-500/30';
      statusEl.textContent = label + ' 更新完成：' + (data.provider?.version || '已更新');
    }
    await refreshProviderRuntime();
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'text-[10px] leading-relaxed rounded-lg px-2.5 py-2 bg-rose-950/40 text-rose-300 border border-rose-500/30';
      statusEl.textContent = label + ' 更新失敗：' + String(err.message || err).slice(-1200);
    }
  } finally {
    if (statusEl) delete statusEl.dataset.busy;
    if (button) {
      button.disabled = false;
      button.textContent = '更新';
    }
  }
}

async function refreshAuthStatus() {
  const codexStatusBadge = document.getElementById('auth-status-codex');
  const codexStatusDesc = document.getElementById('auth-desc-codex');
  const agyStatusBadge = document.getElementById('auth-status-agy');
  const agyStatusDesc = document.getElementById('auth-desc-agy');

  try {
    const res = await fetch('/api/auth/status');
    if (!res.ok) throw new Error('無法取得認證狀態');
    const data = await res.json();

    if (codexStatusBadge && codexStatusDesc) {
      if (data.codex?.loggedIn) {
        codexStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        codexStatusBadge.textContent = '🟢 已登入';
        codexStatusDesc.textContent = '模式: ' + (data.codex.method === 'api_key' ? 'API Key' : 'ChatGPT 帳號') + ' (' + (data.codex.message || '認證有效') + ')';
      } else {
        codexStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse';
        codexStatusBadge.textContent = '🟡 未登入 / 已過期';
        codexStatusDesc.textContent = data.codex?.message || 'Token 已過期或尚未登入，請點擊下方重新認證';
      }
    }

    if (agyStatusBadge && agyStatusDesc) {
      if (data.antigravity?.loggedIn) {
        agyStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        agyStatusBadge.textContent = '🟢 憑證正常';
        agyStatusDesc.textContent = data.antigravity.message || 'Google OAuth 憑證正常運作中';
      } else {
        agyStatusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40';
        agyStatusBadge.textContent = '🟡 憑證缺失';
        agyStatusDesc.textContent = data.antigravity?.message || '尚未建立 OAuth 憑證';
      }
    }
    return data;

  } catch (err) {
    if (codexStatusDesc) codexStatusDesc.textContent = '查詢失敗: ' + err.message;
    if (agyStatusDesc) agyStatusDesc.textContent = '查詢失敗: ' + err.message;
    return null;
  }
}

function setAgyLoginMessage(message, state = 'waiting') {
  const status = document.getElementById('agy-login-live-status');
  if (!status) return;
  const styles = {
    waiting: 'text-[11px] leading-relaxed text-amber-300',
    success: 'text-[11px] leading-relaxed text-emerald-300',
    error: 'text-[11px] leading-relaxed text-rose-300'
  };
  status.className = styles[state] || styles.waiting;
  status.textContent = message;
}

function renderAgyLoginSnapshot(snapshot = {}) {
  const startBtn = document.getElementById('agy-login-start-btn');
  const sessionEl = document.getElementById('agy-login-session');
  const link = document.getElementById('agy-login-link');
  const choiceRow = document.getElementById('agy-login-choice-row');
  const codeRow = document.getElementById('agy-login-code-row');
  const cancelBtn = document.getElementById('agy-login-cancel-btn');
  const refreshBtn = document.getElementById('agy-login-refresh-btn');
  const state = String(snapshot.status || 'idle');
  const active = ['starting', 'awaiting_choice', 'awaiting_code', 'verifying'].includes(state);
  const messages = {
    starting: '正在啟動 AGY，等待 Google 授權連結…',
    awaiting_choice: 'AGY 正在等待選擇登入方式。用上一個／下一個移動，再按「確認選取」。',
    awaiting_code: snapshot.error || '請開啟授權頁登入 Google；若頁面顯示驗證碼，貼到下方送出。',
    verifying: '驗證碼已送出，正在確認 Google 授權…',
    completed: '登入流程完成，正在確認 AGY 憑證…',
    failed: `登入失敗：${String(snapshot.error || 'AGY 登入程序已結束。')}`,
    cancelled: '登入已取消。'
  };

  if (snapshot.sessionId) currentAgyLoginSessionId = snapshot.sessionId;
  else if (state === 'idle') currentAgyLoginSessionId = null;
  if (sessionEl) sessionEl.classList.toggle('hidden', state === 'idle');
  if (startBtn) {
    startBtn.classList.toggle('hidden', active);
    startBtn.disabled = false;
    startBtn.innerHTML = state === 'completed' ? '<span>🔑</span><span>再次登入 Google</span>' : '<span>🔑</span><span>在此登入 Google 帳號</span>';
  }

  let safeUrl = '';
  try {
    const parsed = new URL(snapshot.url || '', window.location.href);
    if (parsed.protocol === 'https:') safeUrl = parsed.toString();
  } catch (_) {}
  if (link) {
    if (safeUrl) {
      link.href = safeUrl;
      link.classList.remove('hidden');
    } else {
      link.removeAttribute('href');
      link.classList.add('hidden');
    }
  }
  if (codeRow) codeRow.classList.toggle('hidden', state !== 'awaiting_code');
  if (choiceRow) {
    choiceRow.classList.toggle('hidden', state !== 'awaiting_choice');
    choiceRow.querySelectorAll('button').forEach(button => { button.disabled = agyLoginMenuInputPending; });
  }
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !active);
  if (refreshBtn) refreshBtn.classList.toggle('hidden', state === 'idle');

  if (messages[state]) setAgyLoginMessage(messages[state], state === 'failed' ? 'error' : state === 'completed' ? 'success' : 'waiting');
  else if (state === 'idle') setAgyLoginMessage('尚未啟動登入。', 'waiting');
}

function isAgyLoginActive(status) {
  return ['starting', 'awaiting_choice', 'awaiting_code', 'verifying'].includes(status);
}

function stopAgyLoginPolling() {
  if (activeAgyLoginPollTimeout) clearTimeout(activeAgyLoginPollTimeout);
  activeAgyLoginPollTimeout = null;
  agyLoginPollSessionId = null;
}

async function finishAgyLogin(snapshot, { announce = true } = {}) {
  stopAgyLoginPolling();
  if (snapshot.status === 'completed') {
    const authStatus = await refreshAuthStatus();
    if (authStatus?.antigravity?.loggedIn) {
      setAgyLoginMessage('✅ Google 授權成功，AGY 已可使用。', 'success');
      if (announce) {
        if (typeof window.haptic === 'function') window.haptic([40, 80, 40]);
        notifyAuthRecoverySuccess('antigravity');
      }
    } else {
      setAgyLoginMessage('登入程序已結束，但尚未確認憑證；請按「重新整理狀態」確認。', 'error');
    }
  }
}

function pollAgyLoginStatus(sessionId) {
  stopAgyLoginPolling();
  agyLoginPollSessionId = sessionId;
  const poll = async () => {
    if (agyLoginPollSessionId !== sessionId) return;
    try {
      const res = await fetch('/api/auth/agy/login-status?sessionId=' + encodeURIComponent(sessionId), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '無法讀取 AGY 登入狀態');
      if (agyLoginPollSessionId !== sessionId) return;
      renderAgyLoginSnapshot(data);
      if (data.status === 'idle') {
        stopAgyLoginPolling();
        renderAgyLoginSnapshot({ sessionId, status: 'failed', error: '登入工作階段已失效，請重新啟動登入。' });
        return;
      }
      if (['completed', 'failed', 'cancelled'].includes(data.status)) {
        await finishAgyLogin(data);
        return;
      }
    } catch (error) {
      setAgyLoginMessage('登入狀態暫時無法讀取：' + String(error.message || error), 'error');
    }
    if (agyLoginPollSessionId === sessionId) {
      activeAgyLoginPollTimeout = setTimeout(poll, 1500);
    }
  };
  activeAgyLoginPollTimeout = setTimeout(poll, 0);
}

async function resumeAgyLoginSession() {
  if (agyLoginResumePromise) return agyLoginResumePromise;
  agyLoginResumePromise = (async () => {
    try {
      const res = await fetch('/api/auth/agy/login-status', { cache: 'no-store' });
      const snapshot = await res.json();
      if (!res.ok) throw new Error(snapshot.error || '無法讀取 AGY 登入狀態');
      renderAgyLoginSnapshot(snapshot);
      if (isAgyLoginActive(snapshot.status) && snapshot.sessionId) pollAgyLoginStatus(snapshot.sessionId);
      else if (snapshot.status === 'completed') await finishAgyLogin(snapshot, { announce: false });
      return snapshot;
    } catch (error) {
      setAgyLoginMessage('登入狀態暫時無法讀取：' + String(error.message || error), 'error');
      return null;
    } finally {
      agyLoginResumePromise = null;
    }
  })();
  return agyLoginResumePromise;
}

async function refreshAgyLoginStatus() {
  const button = document.getElementById('agy-login-refresh-btn');
  if (button) { button.disabled = true; button.textContent = '正在更新…'; }
  try {
    await resumeAgyLoginSession();
  } finally {
    if (button) { button.disabled = false; button.textContent = '重新整理登入狀態'; }
  }
}

async function startAgyLoginFlow() {
  const startBtn = document.getElementById('agy-login-start-btn');
  const sessionEl = document.getElementById('agy-login-session');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = '正在啟動 Google 登入…';
  }
  if (sessionEl) sessionEl.classList.remove('hidden');
  setAgyLoginMessage('正在啟動 AGY，等待 Google 授權連結…', 'waiting');

  try {
    const res = await fetch('/api/auth/agy/login-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '無法啟動 AGY 登入');
    currentAgyLoginSessionId = data.sessionId || '';
    renderAgyLoginSnapshot(data);
    if (isAgyLoginActive(data.status) && currentAgyLoginSessionId) pollAgyLoginStatus(currentAgyLoginSessionId);
    else if (data.status === 'completed') await finishAgyLogin(data);
    if (typeof window.haptic === 'function') window.haptic([30, 50, 30]);
  } catch (error) {
    if (sessionEl) sessionEl.classList.remove('hidden');
    setAgyLoginMessage('啟動登入失敗：' + String(error.message || error), 'error');
    if (startBtn) {
      startBtn.classList.remove('hidden');
      startBtn.disabled = false;
      startBtn.innerHTML = '<span>🔑</span><span>重新啟動 Google 登入</span>';
    }
  }
}

async function submitAgyLoginCode() {
  const input = document.getElementById('agy-login-code');
  const button = document.getElementById('agy-login-code-submit-btn');
  const code = String(input?.value || '').replace(/\s+/gu, '');
  if (!currentAgyLoginSessionId || !code) {
    setAgyLoginMessage('請先完成瀏覽器授權並輸入驗證碼。', 'error');
    return;
  }
  if (button) { button.disabled = true; button.textContent = '正在送出…'; }
  try {
    const res = await fetch('/api/auth/agy/login-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentAgyLoginSessionId, code })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '驗證碼送出失敗');
    if (input) input.value = '';
    renderAgyLoginSnapshot(data);
    pollAgyLoginStatus(currentAgyLoginSessionId);
  } catch (error) {
    setAgyLoginMessage('驗證碼送出失敗：' + String(error.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = '送出驗證碼'; }
  }
}

async function sendAgyLoginMenuInput(action) {
  if (!currentAgyLoginSessionId || !['up', 'down', 'select'].includes(action) || agyLoginMenuInputPending) return;
  agyLoginMenuInputPending = true;
  const choiceRow = document.getElementById('agy-login-choice-row');
  if (choiceRow) choiceRow.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    const res = await fetch('/api/auth/agy/login-input', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentAgyLoginSessionId, action })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '無法操作 AGY 登入選單');
    renderAgyLoginSnapshot(data);
  } catch (error) {
    setAgyLoginMessage('操作登入選單失敗：' + String(error.message || error), 'error');
  } finally {
    agyLoginMenuInputPending = false;
    if (choiceRow) choiceRow.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}

async function cancelAgyLoginFlow() {
  if (!currentAgyLoginSessionId) return;
  const button = document.getElementById('agy-login-cancel-btn');
  if (button) { button.disabled = true; button.textContent = '正在取消…'; }
  try {
    const res = await fetch('/api/auth/agy/login-cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentAgyLoginSessionId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '取消登入失敗');
    stopAgyLoginPolling();
    renderAgyLoginSnapshot({ ...data, sessionId: currentAgyLoginSessionId });
  } catch (error) {
    setAgyLoginMessage('取消登入失敗：' + String(error.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = '取消登入'; }
  }
}

async function startCodexOAuthFlow() {
  const stepContainer = document.getElementById('codex-device-step-container');
  const startBtn = document.getElementById('codex-device-start-btn');
  const linkBtn = document.getElementById('codex-device-link-btn');
  const liveStatus = document.getElementById('codex-device-live-status');
  const codeBoxWrapper = document.getElementById('codex-device-code-box-wrapper');

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> 正在產生登入連結...';
  }

  try {
    const res = await fetch('/api/auth/codex/device-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'oauth' })
    });
    const data = await res.json();

    if (!data.success || !data.url) {
      throw new Error(data.error || '無法取得 OpenAI 登入連結');
    }

    currentAuthSessionId = data.sessionId;

    if (codeBoxWrapper) codeBoxWrapper.classList.add('hidden');
    if (linkBtn) {
      linkBtn.href = data.url;
      linkBtn.target = '_blank';
      linkBtn.innerHTML = '<span>🔗</span><span>前往 OpenAI 授權登入 (點擊開啟)</span>';
    }

    if (stepContainer) stepContainer.classList.remove('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (liveStatus) {
      liveStatus.className = 'text-xs text-amber-300 flex items-center justify-center gap-2 p-2 rounded-xl bg-amber-950/40 border border-amber-500/30';
      liveStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span><span>請點擊上方按鈕前往 OpenAI 完成登入，系統將自動偵測回調...</span>';
    }

    if (typeof window.haptic === 'function') window.haptic([30, 50, 30]);

    // Automatically try to open login window
    try {
      window.open(data.url, '_blank');
    } catch (_) {}

    pollCodexDeviceStatus(data.sessionId);
  } catch (err) {
    alert('啟動登入失敗：' + err.message);
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerHTML = '🔑 使用設備碼登入 Codex (推薦)';
    }
  }
}

async function startCodexDeviceFlow() {
  const stepContainer = document.getElementById('codex-device-step-container');
  const startBtn = document.getElementById('codex-device-start-btn');
  const codeEl = document.getElementById('codex-device-code');
  const linkBtn = document.getElementById('codex-device-link-btn');
  const liveStatus = document.getElementById('codex-device-live-status');
  const codeBoxWrapper = document.getElementById('codex-device-code-box-wrapper');

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> 正在產生驗證碼...';
  }

  try {
    const res = await fetch('/api/auth/codex/device-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'device' })
    });
    const data = await res.json();

    if (!data.success || !data.userCode) {
      throw new Error(data.error || '啟動 Device Auth 失敗');
    }

    currentAuthSessionId = data.sessionId;

    if (codeBoxWrapper) codeBoxWrapper.classList.remove('hidden');
    if (codeEl) codeEl.textContent = data.userCode;
    if (linkBtn) {
      linkBtn.href = data.url || 'https://auth.openai.com/codex/device';
      linkBtn.target = '_blank';
      linkBtn.innerHTML = '<span>↗️</span><span>開啟 OpenAI 設備碼頁面貼上代碼</span>';
    }

    if (stepContainer) stepContainer.classList.remove('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (liveStatus) {
      liveStatus.className = 'text-xs text-amber-300 flex items-center justify-center gap-2 p-2 rounded-xl bg-amber-950/40 border border-amber-500/30';
      liveStatus.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span><span>請複製代碼後點擊上方按鈕前往貼上授權...</span>';
    }

    if (typeof window.haptic === 'function') window.haptic([30, 50, 30]);
    pollCodexDeviceStatus(data.sessionId);
  } catch (err) {
    alert('啟動 Device Auth 失敗：' + err.message);
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerHTML = '🔑 使用設備碼登入 Codex (推薦)';
    }
  }
}

function pollCodexDeviceStatus(sessionId) {
  stopDeviceAuthPolling();

  activeAuthPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/auth/codex/device-status?sessionId=' + encodeURIComponent(sessionId));
      if (!res.ok) return;
      const data = await res.json();

      const liveStatus = document.getElementById('codex-device-live-status');
      const startBtn = document.getElementById('codex-device-start-btn');
      const stepContainer = document.getElementById('codex-device-step-container');

      if (data.status === 'completed') {
        stopDeviceAuthPolling();
        if (liveStatus) {
          liveStatus.className = 'text-xs text-emerald-300 flex items-center justify-center gap-2 p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/50 animate-bounce';
          liveStatus.innerHTML = '<span>🎉</span><span class="font-bold">Codex 登入成功！已就緒可直接對話</span>';
        }
        if (typeof window.haptic === 'function') window.haptic([40, 80, 40]);
        await refreshAuthStatus();
        notifyAuthRecoverySuccess('codex');

        setTimeout(() => {
          if (stepContainer) stepContainer.classList.add('hidden');
          if (startBtn) {
            startBtn.classList.remove('hidden');
            startBtn.disabled = false;
            startBtn.innerHTML = '🔑 再次重新登入 Codex';
          }
        }, 3500);

      } else if (data.status === 'failed' || data.status === 'timeout') {
        stopDeviceAuthPolling();
        if (liveStatus) {
          liveStatus.className = 'text-xs text-rose-300 flex items-center justify-center gap-1.5 p-2 rounded-xl bg-rose-950/40 border border-rose-500/40';
          liveStatus.textContent = '⚠️ 驗證逾時或失敗：' + (data.error || '請重新啟動登入');
        }
        if (startBtn) {
          startBtn.classList.remove('hidden');
          startBtn.disabled = false;
          startBtn.innerHTML = '🔄 重新登入';
        }
      }
    } catch (_) {}
  }, 1500);
}

function stopDeviceAuthPolling() {
  if (activeAuthPollInterval) {
    clearInterval(activeAuthPollInterval);
    activeAuthPollInterval = null;
  }
}

async function copyCodexUserCode() {
  const codeEl = document.getElementById('codex-device-code');
  const copyBtn = document.getElementById('codex-copy-code-btn');
  if (!codeEl || !codeEl.textContent) return;

  const code = codeEl.textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    if (copyBtn) {
      copyBtn.innerHTML = '✓ 已複製';
      copyBtn.classList.add('bg-emerald-600', 'text-white');
      setTimeout(() => {
        copyBtn.innerHTML = '📋 複製代碼';
        copyBtn.classList.remove('bg-emerald-600', 'text-white');
      }, 2000);
    }
    if (typeof window.haptic === 'function') window.haptic('light');
  } catch (_) {
    prompt('請手動複製此代碼：', code);
  }
}

async function saveCodexApiKey() {
  const input = document.getElementById('codex-api-key-input');
  const btn = document.getElementById('codex-api-key-submit-btn');
  if (!input || !input.value.trim()) {
    alert('請輸入 OpenAI API Key (sk-...)');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '儲存認證中...';
  }

  try {
    const res = await fetch('/api/auth/codex/api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: input.value.trim() })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '設定失敗');

    alert('✅ OpenAI API Key 登入成功！');
    input.value = '';
    await refreshAuthStatus();
    notifyAuthRecoverySuccess('codex');
  } catch (err) {
    alert('設定失敗：' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '儲存並登入';
    }
  }
}

async function saveAgyToken() {
  const input = document.getElementById('agy-token-input');
  const btn = document.getElementById('agy-token-submit-btn');
  if (!input || !input.value.trim()) {
    alert('請輸入 Antigravity OAuth Token JSON');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '儲存憑證中...';
  }

  try {
    const res = await fetch('/api/auth/agy/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: input.value.trim() })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '儲存失敗');

    alert('✅ Antigravity 憑證更新成功！');
    input.value = '';
    await refreshAuthStatus();
    notifyAuthRecoverySuccess('antigravity');
  } catch (err) {
    alert('儲存失敗：' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '儲存憑證';
    }
  }
}

let pendingRetryMessage = null;

function renderAuthRecoveryCard(targetElement, provider, errorMsg, originalMessage = null) {
  if (!targetElement) return;
  pendingRetryMessage = originalMessage;

  const providerLabel = provider === 'codex' ? 'OpenAI Codex' : 'Antigravity (AGY)';
  const card = document.createElement('div');
  card.id = 'auth-recovery-card';
  card.className = 'p-3.5 rounded-2xl bg-amber-950/70 border border-amber-500/50 shadow-xl text-xs text-slate-200 space-y-2.5 animate-fadeIn';
  const errText = typeof escapeHtml === 'function' ? escapeHtml(errorMsg || '登入過期') : (errorMsg || '登入過期');
  const isCodex = provider === 'codex';
  
  card.innerHTML = [
    '<div class="flex items-center justify-between border-b border-amber-500/30 pb-2">',
    '  <div class="flex items-center gap-2 text-amber-300 font-bold">',
    '    <span class="text-base">🔐</span>',
    '    <span>' + providerLabel + ' 登入已過期或未認證</span>',
    '  </div>',
    '  <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">401 授權過期</span>',
    '</div>',
    '<p class="text-slate-300 leading-relaxed text-[11px]">',
    '  系統偵測到目前 Provider 憑證已過期（' + errText + '）。你可直接透過網頁完成一鍵認證，無需切換到 Termux。',
    '</p>',
    '<div class="flex flex-wrap gap-2 pt-1" id="auth-recovery-actions">',
    '  <button type="button" class="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-semibold flex items-center gap-1.5 shadow-lg shadow-amber-900/40 cursor-pointer" onclick="openAuthModal(); ' + (isCodex ? 'startCodexDeviceFlow();' : '') + '">',
    '    <span>🔑</span>',
    '    <span>立即在網頁上登入認證</span>',
    '  </button>',
    '  <button type="button" class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 text-[11px] font-mono cursor-pointer" onclick="openAuthModal()">',
    '    ⚙️ 認證設定',
    '  </button>',
    '</div>'
  ].join('\n');

  targetElement.innerHTML = '';
  targetElement.appendChild(card);
}

function notifyAuthRecoverySuccess(provider) {
  const card = document.getElementById('auth-recovery-card');
  if (!card) return;

  const actions = card.querySelector('#auth-recovery-actions');
  if (actions) {
    actions.innerHTML = [
      '<div class="w-full flex items-center justify-between p-2 rounded-xl bg-emerald-950/80 border border-emerald-500/60 text-emerald-300">',
      '  <span class="flex items-center gap-1 font-bold"><span>✅</span><span>認證成功！已恢復連線</span></span>',
      '  <button type="button" class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-semibold text-xs shadow cursor-pointer" onclick="retryPendingAuthMessage()">',
      '    ⚡ 一鍵重發訊息',
      '  </button>',
      '</div>'
    ].join('\n');
  }
}

function retryPendingAuthMessage() {
  const card = document.getElementById('auth-recovery-card');
  if (card) card.remove();
  if (pendingRetryMessage && typeof sendMessage === 'function') {
    const msg = pendingRetryMessage;
    pendingRetryMessage = null;
    sendMessage(msg);
  } else if (typeof sendMessage === 'function') {
    sendMessage();
  }
}

// Global Export to window object
window.isAuthErrorMessage = isAuthErrorMessage;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.refreshAuthStatus = refreshAuthStatus;
window.startCodexOAuthFlow = startCodexOAuthFlow;
window.startCodexDeviceFlow = startCodexDeviceFlow;
window.copyCodexUserCode = copyCodexUserCode;
window.saveCodexApiKey = saveCodexApiKey;
window.saveAgyToken = saveAgyToken;
window.startAgyLoginFlow = startAgyLoginFlow;
window.submitAgyLoginCode = submitAgyLoginCode;
window.sendAgyLoginMenuInput = sendAgyLoginMenuInput;
window.cancelAgyLoginFlow = cancelAgyLoginFlow;
window.refreshAgyLoginStatus = refreshAgyLoginStatus;
window.refreshProviderRuntime = refreshProviderRuntime;
window.updateRuntimeProvider = updateRuntimeProvider;
window.renderAuthRecoveryCard = renderAuthRecoveryCard;
window.notifyAuthRecoverySuccess = notifyAuthRecoverySuccess;
window.retryPendingAuthMessage = retryPendingAuthMessage;

function initAuthUI() {
  const authMenuBtn = document.getElementById('auth-menu-btn');
  const closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
  const authModal = document.getElementById('auth-modal');
  const resumeVisibleAuth = () => {
    if (!document.hidden && authModal && !authModal.classList.contains('opacity-0')) {
      resumeAgyLoginSession();
    }
  };

  if (authMenuBtn) {
    authMenuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openAuthModal();
    });
  }
  if (closeAuthModalBtn) {
    closeAuthModalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeAuthModal();
    });
  }
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });
  }
  document.addEventListener('visibilitychange', resumeVisibleAuth);
  window.addEventListener('pageshow', resumeVisibleAuth);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
  initAuthUI();
}
