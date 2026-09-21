// Crew Home: phone-first control center and secure LAN console.
(() => {
  'use strict';

  const modal = document.getElementById('crew-home-modal');
  const openButton = document.getElementById('crew-home-btn');
  const closeButton = document.getElementById('crew-home-close-btn');
  const refreshButton = document.getElementById('crew-home-refresh-btn');
  const allTasksButton = document.getElementById('crew-home-all-tasks-btn');
  const recent = document.getElementById('crew-home-recent');
  const running = document.getElementById('crew-home-running');
  const pending = document.getElementById('crew-home-pending');
  const completed = document.getElementById('crew-home-completed');
  const remoteStatus = document.getElementById('crew-home-remote-status');
  const remoteBadge = document.getElementById('crew-home-remote-badge');
  const remoteToggle = document.getElementById('crew-home-remote-toggle');
  const remoteUrlWrap = document.getElementById('crew-home-remote-url-wrap');
  const remoteBaseUrl = document.getElementById('crew-home-remote-base-url');
  const remoteSecureWrap = document.getElementById('crew-home-remote-secure-wrap');
  const remoteUrl = document.getElementById('crew-home-remote-url');
  const copyUrlButton = document.getElementById('crew-home-copy-url');
  const remotePairButton = document.getElementById('crew-home-remote-pair');
  const remotePairHint = document.getElementById('crew-home-remote-pair-hint');
  const remoteQrWrap = document.getElementById('crew-home-remote-qr-wrap');
  const remoteQr = document.getElementById('crew-home-remote-qr');
  const remoteAltWrap = document.getElementById('crew-home-remote-alt-wrap');
  const remoteAlt = document.getElementById('crew-home-remote-alt');
  const remoteConnections = document.getElementById('crew-home-remote-connections');
  const remoteConnectionCount = document.getElementById('crew-home-remote-connection-count');
  const remoteConnectionList = document.getElementById('crew-home-remote-connection-list');
  const remoteRevokeAllButton = document.getElementById('crew-home-remote-revoke-all');
  const subtitle = document.getElementById('crew-home-subtitle');

  let latestRemote = null;
  let loading = false;
  let renderedQrValue = '';
  let pairingUrl = '';
  let pairingExpiresAt = 0;
  let pairingLoading = false;

  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function stripTokenFromAddressBar() {
    try {
      const current = new URL(window.location.href);
      if (!current.searchParams.has('token') && !current.searchParams.has('pair')) return;
      current.searchParams.delete('token');
      current.searchParams.delete('pair');
      const query = current.searchParams.toString();
      history.replaceState({}, '', current.pathname + (query ? `?${query}` : '') + current.hash);
    } catch (_) {}
  }

  function setVisible(visible) {
    if (!modal) return;
    if (visible) {
      document.getElementById('tools-menu-dropdown')?.classList.add('hidden');
      document.getElementById('tools-sheet-overlay')?.classList.add('hidden');
    }
    modal.classList.toggle('opacity-0', !visible);
    modal.classList.toggle('pointer-events-none', !visible);
    if (visible) loadHome();
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    const now = Date.now();
    const ageMinutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
    if (ageMinutes < 1) return '剛剛';
    if (ageMinutes < 60) return `${ageMinutes} 分鐘前`;
    if (ageMinutes < 24 * 60) return `${Math.floor(ageMinutes / 60)} 小時前`;
    return date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  }

  function taskStatus(task) {
    const meta = {
      running: ['處理中', 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30'],
      pending_confirmation: ['等確認', 'text-amber-300 bg-amber-500/10 border-amber-500/30'],
      completed: ['已完成', 'text-teal-300 bg-teal-500/10 border-teal-500/30'],
      failed: ['失敗', 'text-rose-300 bg-rose-500/10 border-rose-500/30']
    };
    return meta[task.status] || [task.status || '未知', 'text-slate-400 bg-slate-800 border-slate-700'];
  }

  function renderRecent(tasks) {
    if (!recent) return;
    if (!tasks.length) {
      recent.innerHTML = '<div class="py-8 text-center text-xs text-slate-500">目前沒有背景任務。</div>';
      return;
    }

    recent.innerHTML = tasks.slice(0, 3).map(task => {
      const [label, badgeClass] = taskStatus(task);
      const canOpen = Boolean(task.conversationId);
      const actionLabel = task.status === 'completed' ? '查看結果' : '開啟對話';
      return `<div class="px-3 py-2.5 flex items-start gap-2.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold shrink-0 ${badgeClass}">${label}</span>
            <span class="text-[10px] text-slate-500 truncate">${escapeHtml(task.conversationTitle || '未命名對話')}</span>
          </div>
          <div class="mt-1 text-[11px] font-semibold text-slate-200 break-words">${escapeHtml(task.title || 'AI 任務')}</div>
          <div class="mt-0.5 text-[9px] text-slate-600">${formatTime(task.updatedAt)}</div>
        </div>
        <button
          data-home-task-id="${escapeHtml(task.id)}"
          data-home-task-provider="${escapeHtml(task.provider || 'antigravity')}"
          data-home-task-conversation="${escapeHtml(task.conversationId || '')}"
          data-home-task-status="${escapeHtml(task.status || '')}"
          class="shrink-0 min-h-8 px-2.5 rounded-lg border border-slate-700 bg-slate-900 text-[10px] text-slate-300 active:scale-95 disabled:opacity-40"
          ${canOpen ? '' : 'disabled'}
        >${actionLabel}</button>
      </div>`;
    }).join('');
  }

  function isRemoteBrowser() {
    const host = String(location.hostname || '').toLowerCase();
    return !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
  }

  function renderRemoteConnections(remote, remoteClient) {
    if (!remoteConnections) return;
    const count = Number(remote.connectionCount || 0);
    const current = remote.currentConnection;
    if (remoteConnectionCount) {
      remoteConnectionCount.textContent = remoteClient && current
        ? '此電腦已連線'
        : `${count} 台電腦連線`;
    }

    if (remoteConnectionList) {
      const connections = Array.isArray(remote.connections) ? remote.connections : [];
      remoteConnectionList.innerHTML = connections.length
        ? connections.map(connection => {
          const device = escapeHtml(connection.userAgent || '未知瀏覽器');
          const address = escapeHtml(connection.address || '未知位址');
          const lastSeen = formatTime(connection.lastSeen) || '剛剛';
          return `<div class="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-[10px] font-semibold text-slate-200">${device}</div>
              <div class="mt-0.5 truncate text-[9px] text-slate-500">${address} · ${lastSeen}</div>
            </div>
            <button data-remote-revoke="${escapeHtml(connection.id)}" class="shrink-0 min-h-8 px-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-200 active:scale-95">中斷</button>
          </div>`;
        }).join('')
        : (remoteClient && current
          ? '<div class="text-[9px] text-slate-500">這個瀏覽器已取得自己的工作階段。</div>'
          : '<div class="text-[9px] text-slate-500">目前沒有活躍的電腦連線。</div>');
    }

    const showSummary = Boolean(remote.active || remote.configuredEnabled || remoteClient);
    remoteConnections.classList.toggle('hidden', !showSummary);
    if (remoteRevokeAllButton) {
      const canManage = !remoteClient && count > 0;
      remoteRevokeAllButton.classList.toggle('hidden', !canManage);
      remoteRevokeAllButton.disabled = !canManage;
    }
  }

  function renderRemoteQr(value) {
    if (!remoteQrWrap || !remoteQr) return;
    const text = String(value || '').trim();
    if (!text) {
      renderedQrValue = '';
      remoteQr.innerHTML = '';
      remoteQrWrap.classList.add('hidden');
      return;
    }

    remoteQrWrap.classList.remove('hidden');
    if (renderedQrValue === text && remoteQr.childNodes.length > 0) return;
    renderedQrValue = text;
    remoteQr.innerHTML = '';

    if (typeof QRCode !== 'function') {
      remoteQr.innerHTML = '<div class="max-w-[180px] text-center text-[10px] text-slate-500">QR 元件未載入，請直接使用上方 URL。</div>';
      return;
    }

    try {
      new QRCode(remoteQr, {
        text,
        width: 164,
        height: 164,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (error) {
      console.warn('[Crew Home] QR generation failed:', error);
      remoteQr.innerHTML = '<div class="max-w-[180px] text-center text-[10px] text-slate-500">QR 產生失敗，請直接使用上方 URL。</div>';
    }
  }

  function renderRemote(remote) {
    latestRemote = remote || null;
    if (!remote) return;

    const remoteClient = isRemoteBrowser();
    const urls = Array.isArray(remote.urls) ? remote.urls.filter(Boolean) : [];
    const primaryUrl = urls[0] || '';

    if (remoteStatus) {
      if (remote.active) {
        remoteStatus.textContent = remoteClient
          ? '已連到手機主機 · 此電腦已授權'
          : '已開放給同一個 Wi-Fi 的電腦';
        remoteStatus.className = 'mt-1 text-[10px] text-teal-300';
      } else if (remote.configuredEnabled) {
        remoteStatus.textContent = '設定已開啟，Runtime 正在切換連線模式';
        remoteStatus.className = 'mt-1 text-[10px] text-amber-300';
      } else {
        remoteStatus.textContent = '目前只有手機本機可以連線';
        remoteStatus.className = 'mt-1 text-[10px] text-slate-500';
      }
    }

    if (remoteBadge) {
      if (remote.active) {
        remoteBadge.textContent = remoteClient ? '已連線' : '已開啟';
        remoteBadge.className = 'rounded-full border border-teal-500/35 bg-teal-500/10 px-2 py-0.5 text-[9px] font-semibold text-teal-300';
      } else if (remote.configuredEnabled) {
        remoteBadge.textContent = '切換中';
        remoteBadge.className = 'rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-300';
      } else {
        remoteBadge.textContent = '已關閉';
        remoteBadge.className = 'rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[9px] font-semibold text-slate-400';
      }
    }

    if (remoteToggle) {
      if (remoteClient && remote.active) {
        remoteToggle.disabled = true;
        remoteToggle.textContent = '請從手機管理';
        remoteToggle.classList.add('opacity-50');
      } else {
        remoteToggle.disabled = false;
        remoteToggle.textContent = remote.configuredEnabled ? '關閉連線' : '開啟連線';
        remoteToggle.classList.remove('opacity-50');
      }
    }

    renderRemoteConnections(remote, remoteClient);

    if (remoteUrlWrap) {
      const showConnectionInfo = Boolean(remote.configuredEnabled && primaryUrl);
      remoteUrlWrap.classList.toggle('hidden', !showConnectionInfo);
    }
    if (remoteBaseUrl) remoteBaseUrl.textContent = primaryUrl;

    if (remoteSecureWrap && remoteUrl) {
      const canPair = !remoteClient && Boolean(remote.pairingAvailable);
      remoteSecureWrap.classList.toggle('hidden', !canPair);
      remoteUrl.textContent = pairingUrl || '';
      if (remotePairButton) {
        remotePairButton.disabled = pairingLoading || !canPair;
        remotePairButton.textContent = pairingLoading
          ? '產生中…'
          : (pairingUrl && pairingExpiresAt > Date.now() ? '重新產生' : '產生 QR');
        remotePairButton.classList.toggle('opacity-50', remotePairButton.disabled);
      }
      if (copyUrlButton) {
        const canCopy = Boolean(pairingUrl && pairingExpiresAt > Date.now());
        copyUrlButton.classList.toggle('hidden', !canCopy);
        copyUrlButton.disabled = !canCopy;
      }
      if (remotePairHint) {
        remotePairHint.textContent = pairingUrl && pairingExpiresAt > Date.now()
          ? `此連結將於 ${new Date(pairingExpiresAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 到期，且只能使用一次。`
          : '產生 QR，讓電腦首次連線；2 分鐘內有效且只能使用一次。';
      }
      renderRemoteQr(pairingUrl);
    }

    if (remoteAltWrap && remoteAlt) {
      const alternatives = urls.slice(1, 4);
      if (alternatives.length) {
        remoteAlt.innerHTML = alternatives
          .map(address => `<div class="break-all">${escapeHtml(address)}</div>`)
          .join('');
        remoteAltWrap.classList.remove('hidden');
      } else {
        remoteAlt.innerHTML = '';
        remoteAltWrap.classList.add('hidden');
      }
    }
  }

  async function createPairing() {
    if (pairingLoading || !latestRemote?.pairingAvailable || isRemoteBrowser()) return false;
    pairingLoading = true;
    renderRemote(latestRemote);
    try {
      const response = await fetch('/api/remote-pairing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.pairing?.url) {
        throw new Error(data.error || '配對連結產生失敗');
      }
      pairingUrl = String(data.pairing.url);
      pairingExpiresAt = Number(data.pairing.expiresAt || 0);
      return true;
    } catch (error) {
      pairingUrl = '';
      pairingExpiresAt = 0;
      if (remoteStatus) {
        remoteStatus.textContent = String(error?.message || error || '配對連結產生失敗');
        remoteStatus.className = 'mt-1 text-[10px] text-rose-300';
      }
      return false;
    } finally {
      pairingLoading = false;
      renderRemote(latestRemote);
    }
  }

  async function loadHome() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('/api/home', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Crew Home 載入失敗');

      if (running) running.textContent = String(data.counts?.running ?? 0);
      if (pending) pending.textContent = String(data.counts?.pending ?? 0);
      if (completed) completed.textContent = String(data.counts?.completed ?? 0);
      if (subtitle) {
        const device = data.runtime?.device ? ` · ${data.runtime.device}` : '';
        subtitle.textContent = `手機是主機 · 這裡看所有 AI 工作${device}`;
      }
      renderRecent(data.recentTasks || []);
      renderRemote(data.remote);
    } catch (error) {
      const message = String(error?.message || error || 'Crew Home 載入失敗');
      const staleRuntime = /Unknown API endpoint/i.test(message);
      if (recent) {
        recent.innerHTML = staleRuntime
          ? '<div class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left"><div class="text-xs font-semibold text-amber-200">Runtime 還在跑舊版</div><div class="mt-1 text-[10px] leading-relaxed text-slate-400">Web UI 已更新，但 Node Runtime 尚未重啟，所以還不認得 Crew Home / Task API。請重啟 Crew Runtime 後再開一次。</div></div>'
          : `<div class="py-8 text-center text-xs text-rose-300">${escapeHtml(message)}</div>`;
      }
      if (staleRuntime && remoteStatus) {
        remoteStatus.textContent = '需要先重啟 Crew Runtime 才能控制 Remote Console';
        remoteStatus.className = 'mt-1 text-[10px] text-amber-300';
      }
      if (staleRuntime && remoteToggle) {
        remoteToggle.disabled = true;
        remoteToggle.textContent = '先重啟 Runtime';
        remoteToggle.classList.add('opacity-50');
      }
    } finally {
      loading = false;
    }
  }

  async function waitForRuntime() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1200 : 700));
      try {
        const response = await fetch('/healthz', { cache: 'no-store' });
        if (response.ok || response.status === 204) {
          window.setTimeout(() => window.location.reload(), 250);
          return true;
        }
      } catch (_) {}
    }
    if (remoteStatus) {
      remoteStatus.textContent = 'Runtime 尚未恢復，請回到 Crew Pocket 後重新整理';
      remoteStatus.className = 'mt-0.5 text-[10px] text-rose-300';
    }
    return false;
  }

  async function toggleRemote() {
    if (!latestRemote || !remoteToggle || remoteToggle.disabled) return;
    const enabling = !latestRemote.configuredEnabled;
    const message = enabling
      ? '開啟後，同一 Wi-Fi 的電腦可用安全連結操作這支手機上的 Crew Pocket。Runtime 會自動重啟一次。確定開啟？'
      : '關閉後，電腦會立刻失去 Crew Pocket 連線，只保留手機本機。確定關閉？';
    if (!confirm(message)) return;

    pairingUrl = '';
    pairingExpiresAt = 0;
    remoteToggle.disabled = true;
    remoteToggle.textContent = '套用中…';
    try {
      const response = await fetch('/api/remote-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabling })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '遠端連線設定失敗');
      latestRemote = data.remote || { configuredEnabled: enabling };
      renderRemote(latestRemote);
      if (remoteStatus) {
        remoteStatus.textContent = 'Runtime 正在重啟套用設定…';
        remoteStatus.className = 'mt-0.5 text-[10px] text-amber-300';
      }
      await waitForRuntime();
    } catch (error) {
      remoteToggle.disabled = false;
      remoteToggle.textContent = latestRemote?.configuredEnabled ? '關閉' : '開啟';
      alert(error.message);
    }
  }

  async function copyRemoteUrl() {
    const value = String(remoteUrl?.textContent || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copyUrlButton.textContent = '已複製';
      setTimeout(() => { copyUrlButton.textContent = '複製'; }, 1200);
    } catch (_) {
      if (remoteUrl) {
        const range = document.createRange();
        range.selectNodeContents(remoteUrl);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  async function revokeRemoteConnection(id) {
    if (!id) return;
    try {
      const response = await fetch('/api/remote-connections/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '中斷連線失敗');
      await loadHome();
    } catch (error) {
      alert(error.message || '中斷連線失敗');
    }
  }

  async function revokeAllRemoteConnections() {
    if (!confirm('要中斷全部電腦連線嗎？它們需要重新配對才能再次使用。')) return;
    try {
      const response = await fetch('/api/remote-connections/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '中斷連線失敗');
      await loadHome();
    } catch (error) {
      alert(error.message || '中斷連線失敗');
    }
  }

  async function openTask(button) {
    const conversationId = button.dataset.homeTaskConversation;
    const provider = button.dataset.homeTaskProvider || 'antigravity';
    const taskId = button.dataset.homeTaskId;
    const status = button.dataset.homeTaskStatus;
    if (!conversationId) return;
    button.disabled = true;
    setVisible(false);
    try {
      if (status === 'completed' && typeof window.openCrewTaskResult === 'function') {
        await window.openCrewTaskResult(provider, conversationId, taskId);
      } else if (typeof window.openCrewConversation === 'function') {
        await window.openCrewConversation(provider, conversationId);
      }
    } finally {
      button.disabled = false;
    }
  }

  stripTokenFromAddressBar();

  openButton?.addEventListener('click', () => setVisible(true));
  closeButton?.addEventListener('click', () => setVisible(false));
  refreshButton?.addEventListener('click', loadHome);
  allTasksButton?.addEventListener('click', () => setVisible(false));
  remoteToggle?.addEventListener('click', toggleRemote);
  remotePairButton?.addEventListener('click', createPairing);
  copyUrlButton?.addEventListener('click', copyRemoteUrl);
  remoteRevokeAllButton?.addEventListener('click', revokeAllRemoteConnections);
  modal?.addEventListener('click', event => {
    if (event.target === modal) setVisible(false);
  });
  remoteConnectionList?.addEventListener('click', event => {
    const button = event.target.closest('[data-remote-revoke]');
    if (button) revokeRemoteConnection(button.dataset.remoteRevoke);
  });
  recent?.addEventListener('click', event => {
    const button = event.target.closest('[data-home-task-id]');
    if (button) openTask(button);
  });

  window.openCrewHome = () => setVisible(true);
})();
