// 🔐 Provider Authentication & Login Manager (Codex Device Auth + AGY Token)
let activeAuthPollInterval = null;
let currentAuthSessionId = null;

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
}

function closeAuthModal() {
  const authModal = document.getElementById('auth-modal');
  if (!authModal) return;
  authModal.classList.add('opacity-0', 'pointer-events-none');
  stopDeviceAuthPolling();
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
  } catch (err) {
    if (codexStatusDesc) codexStatusDesc.textContent = '查詢失敗: ' + err.message;
    if (agyStatusDesc) agyStatusDesc.textContent = '查詢失敗: ' + err.message;
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
      startBtn.innerHTML = '🌐 瀏覽器一鍵快速登入 (推薦)';
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
      startBtn.innerHTML = '🌐 瀏覽器一鍵快速登入 (推薦)';
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
            startBtn.innerHTML = '🌐 再次重新登入 Codex';
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
window.renderAuthRecoveryCard = renderAuthRecoveryCard;
window.notifyAuthRecoverySuccess = notifyAuthRecoverySuccess;
window.retryPendingAuthMessage = retryPendingAuthMessage;

function initAuthUI() {
  const authMenuBtn = document.getElementById('auth-menu-btn');
  const closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
  const authModal = document.getElementById('auth-modal');

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
  initAuthUI();
}
