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
  const remoteQrWrap = document.getElementById('crew-home-remote-qr-wrap');
  const remoteQr = document.getElementById('crew-home-remote-qr');
  const remoteAltWrap = document.getElementById('crew-home-remote-alt-wrap');
  const remoteAlt = document.getElementById('crew-home-remote-alt');
  const subtitle = document.getElementById('crew-home-subtitle');

  let latestRemote = null;
  let loading = false;
  let renderedQrValue = '';

  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function stripTokenFromAddressBar() {
    try {
      const current = new URL(window.location.href);
      if (!current.searchParams.has('token')) return;
      current.searchParams.delete('token');
      const query = current.searchParams.toString();
      history.replaceState({}, '', current.pathname + (query ? `?${query}` : '') + current.hash);
    } catch (_) {}
  }

  function setVisible(visible) {
    if (!modal) return;
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

    recent.innerHTML = tasks.map(task => {
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

    if (remoteUrlWrap) {
      const showConnectionInfo = Boolean(remote.configuredEnabled && primaryUrl);
      remoteUrlWrap.classList.toggle('hidden', !showConnectionInfo);
    }
    if (remoteBaseUrl) remoteBaseUrl.textContent = primaryUrl;

    if (remoteSecureWrap && remoteUrl) {
      const hasSecureUrl = Boolean(remote.shareUrl);
      remoteSecureWrap.classList.toggle('hidden', !hasSecureUrl);
      remoteUrl.textContent = remote.shareUrl || '';
      renderRemoteQr(remote.shareUrl || '');
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
      if (recent) recent.innerHTML = `<div class="py-8 text-center text-xs text-rose-300">${escapeHtml(error.message)}</div>`;
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
          await loadHome();
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
  copyUrlButton?.addEventListener('click', copyRemoteUrl);
  modal?.addEventListener('click', event => {
    if (event.target === modal) setVisible(false);
  });
  recent?.addEventListener('click', event => {
    const button = event.target.closest('[data-home-task-id]');
    if (button) openTask(button);
  });

  window.openCrewHome = () => setVisible(true);
})();
