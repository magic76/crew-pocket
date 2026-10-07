(() => {
  'use strict';

  const modal = document.getElementById('crew-messages-modal');
  const list = document.getElementById('crew-messages-list');
  const subtitle = document.getElementById('crew-messages-subtitle');
  const openButtons = document.querySelectorAll('[data-open-crew-messages]');
  const closeButton = document.getElementById('close-crew-messages-btn');
  const refreshButton = document.getElementById('refresh-crew-messages-btn');
  let pollTimer = null;

  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatTime = value => {
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  };

  function renderMessages(messages, roleId) {
    if (!list) return;
    if (!messages.length) {
      list.innerHTML = '<div class="py-10 text-center text-xs text-slate-500">目前沒有角色訊息。</div>';
      return;
    }
    list.innerHTML = messages.map(message => {
      const sent = message.fromRoleId === roleId;
      const partner = sent ? message.toRoleName : message.fromRoleName;
      return `<article class="rounded-xl border ${sent ? 'border-indigo-500/25 bg-indigo-950/25' : 'border-teal-500/25 bg-teal-950/20'} p-3">
        <div class="flex items-center justify-between gap-2 text-[10px]">
          <span class="font-semibold ${sent ? 'text-indigo-300' : 'text-teal-300'}">${sent ? '寄給' : '來自'} ${escapeHtml(partner || '未知角色')}</span>
          <time class="shrink-0 text-slate-500">${escapeHtml(formatTime(message.createdAt))}</time>
        </div>
        <p class="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-200">${escapeHtml(message.content)}</p>
        ${message.replyToId ? '<div class="mt-2 text-[9px] text-slate-500">↩ 回覆訊息</div>' : ''}
      </article>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  }

  async function loadMessages() {
    if (!list) return;
    const roleId = typeof window.getCurrentRoleId === 'function' ? window.getCurrentRoleId() : '';
    if (!roleId) {
      list.innerHTML = '<div class="py-8 text-center text-xs text-rose-300">目前對話尚未選擇 Role。</div>';
      return;
    }
    try {
      const response = await fetch(`/api/crew-messages?role_id=${encodeURIComponent(roleId)}&limit=200`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '無法載入角色訊息');
      if (subtitle) subtitle.textContent = `${data.role?.name || roleId} · 收件與寄件記錄`;
      renderMessages(data.messages || [], roleId);
    } catch (error) {
      list.innerHTML = `<div class="py-8 text-center text-xs text-rose-300">${escapeHtml(error.message || '無法載入角色訊息')}</div>`;
    }
  }

  function setVisible(visible) {
    if (!modal) return;
    modal.classList.toggle('opacity-0', !visible);
    modal.classList.toggle('pointer-events-none', !visible);
    if (visible) {
      loadMessages();
      if (!pollTimer) pollTimer = setInterval(loadMessages, 4000);
    } else if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  openButtons.forEach(button => button.addEventListener('click', () => setVisible(true)));
  if (closeButton) closeButton.addEventListener('click', () => setVisible(false));
  if (refreshButton) refreshButton.addEventListener('click', loadMessages);
  if (modal) modal.addEventListener('click', event => { if (event.target === modal) setVisible(false); });
})();
