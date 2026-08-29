// Crew Pocket Task Center: persistent, user-controlled background work.
(() => {
  'use strict';

  const modal = document.getElementById('task-center-modal');
  const list = document.getElementById('task-center-list');
  const openButtons = document.querySelectorAll('[data-open-task-center]');
  const closeButton = document.getElementById('close-task-center-btn');
  const refreshButton = document.getElementById('refresh-task-center-btn');
  let pollTimer = null;

  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const statusMeta = {
    pending_confirmation: ['等待確認', 'border-amber-500/40 bg-amber-500/15 text-amber-300'],
    running: ['處理中', 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'],
    completed: ['已完成', 'border-teal-500/40 bg-teal-500/15 text-teal-300'],
    failed: ['失敗', 'border-rose-500/40 bg-rose-500/15 text-rose-300'],
    cancelled: ['已取消', 'border-slate-600 bg-slate-800 text-slate-300']
  };

  function formatTime(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function setModalVisible(visible) {
    if (!modal) return;
    modal.classList.toggle('opacity-0', !visible);
    modal.classList.toggle('pointer-events-none', !visible);
    if (visible) {
      loadTasks();
      if (!pollTimer) pollTimer = setInterval(loadTasks, 1800);
    } else if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function renderTasks(tasks) {
    if (!list) return;
    if (!tasks.length) {
      list.innerHTML = '<div class="py-10 text-center text-xs text-slate-500">目前沒有任務。從 Live 交辦主對話後，會在這裡追蹤進度。</div>';
      return;
    }
    list.innerHTML = tasks.map(task => {
      const [statusLabel, statusClass] = statusMeta[task.status] || [task.status || '未知', 'border-slate-600 bg-slate-800 text-slate-300'];
      const lastEvent = Array.isArray(task.events) ? task.events.at(-1) : null;
      const detail = task.status === 'completed' ? task.result : (task.status === 'failed' ? task.error : lastEvent?.message);
      const action = task.status === 'running' || task.status === 'pending_confirmation'
        ? `<button data-task-action="cancel" data-task-id="${escapeHtml(task.id)}" class="min-h-[40px] px-3 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 text-[11px] font-semibold active:scale-95">取消</button>`
        : (task.status === 'failed' || task.status === 'cancelled'
          ? `<button data-task-action="retry" data-task-id="${escapeHtml(task.id)}" class="min-h-[40px] px-3 rounded-lg border border-indigo-500/50 bg-indigo-500/15 text-indigo-200 text-[11px] font-semibold active:scale-95">重試</button>`
          : '');
      return `<article class="rounded-xl border border-slate-800 bg-slate-950/75 p-3 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><div class="text-xs font-semibold text-slate-100 break-words">${escapeHtml(task.title)}</div><div class="mt-0.5 text-[10px] font-mono text-slate-500">${task.source === 'live' ? '🎙️ Live' : '💬 主對話'} · ${formatTime(task.updatedAt)}</div></div>
          <span class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass}">${statusLabel}</span>
        </div>
        <p class="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">${escapeHtml(task.task)}</p>
        ${detail ? `<div class="rounded-lg border border-slate-800 bg-black/25 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words ${task.status === 'failed' ? 'text-rose-300' : 'text-slate-300'}">${escapeHtml(detail)}</div>` : ''}
        ${action ? `<div class="flex justify-end">${action}</div>` : ''}
      </article>`;
    }).join('');
  }

  async function loadTasks() {
    if (!list) return;
    try {
      const response = await fetch('/api/tasks?limit=80');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '無法載入任務');
      renderTasks(data.tasks || []);
    } catch (error) {
      list.innerHTML = `<div class="py-8 text-center text-xs text-rose-300">${escapeHtml(error.message)}</div>`;
    }
  }

  async function handleTaskAction(action, taskId, button) {
    if (!action || !taskId) return;
    if (button) button.disabled = true;
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, task_id: taskId })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '任務操作失敗');
      if (navigator.vibrate) navigator.vibrate(18);
      await loadTasks();
    } catch (error) {
      if (button) button.disabled = false;
      alert(error.message);
    }
  }

  openButtons.forEach(button => button.addEventListener('click', () => setModalVisible(true)));
  if (closeButton) closeButton.addEventListener('click', () => setModalVisible(false));
  if (refreshButton) refreshButton.addEventListener('click', loadTasks);
  if (modal) modal.addEventListener('click', event => { if (event.target === modal) setModalVisible(false); });
  if (list) list.addEventListener('click', event => {
    const button = event.target.closest('[data-task-action]');
    if (button) handleTaskAction(button.dataset.taskAction, button.dataset.taskId, button);
  });
  window.refreshTaskCenter = loadTasks;
})();
