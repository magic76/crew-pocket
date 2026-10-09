/* Crew Cockpit: an event-driven view of real Role runtime state. */
(() => {
  'use strict';
  const view = document.getElementById('role-nav-view');
  const focus = document.getElementById('cockpit-focus-panel');
  const command = document.getElementById('cockpit-command-panel');
  const statusLine = document.getElementById('cockpit-status-line');
  const modeButtons = [...document.querySelectorAll('[data-cockpit-mode]')];
  if (!view || !focus || !command || !window.CrewCockpitModel) return;

  const STORAGE_KEY = 'crew_cockpit_mode';
  let mode = 'command';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'focus' || saved === 'command') mode = saved;
  } catch (_) {}
  let lastRenderFingerprint = '';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const tr = (zh, en) => window.getCrewLocale?.() === 'en' ? en : zh;
  const statusText = state => ({
    working: tr('工作中', 'Working'), waiting: tr('等待處理', 'Waiting'),
    idle: tr('待命', 'Idle'), new: tr('新工作', 'New'), unknown: tr('狀態未知', 'Unknown')
  })[state] || tr('狀態未知', 'Unknown');

  const timeAgo = timestamp => {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
    if (minutes < 1) return tr('剛剛', 'Just now');
    if (minutes < 60) return minutes + tr(' 分鐘前', 'm ago');
    if (minutes < 1440) return Math.floor(minutes / 60) + tr(' 小時前', 'h ago');
    if (minutes < 10080) return Math.floor(minutes / 1440) + tr(' 天前', 'd ago');
    return new Date(timestamp).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  };

  const roleLabel = role => {
    if (!role) return '';
    return '<span class="cockpit-state" data-state="' + escape(role.state) + '">' +
      '<span class="cockpit-state-dot" aria-hidden="true"></span>' + statusText(role.state) + '</span>';
  };
  const link = (role, label, type = 'open') =>
    '<button type="button" class="cockpit-action" data-cockpit-action="' + type +
    '" data-cockpit-role-id="' + escape(role.id) + '">' + label + '</button>';

  function renderFocus(data) {
    const role = data.active;
    if (!role) {
      focus.innerHTML = '<div class="cockpit-empty">' + tr('尚未建立 Role，請先新增一位小隊成員。', 'No Roles yet. Add a crew member to begin.') + '</div>';
      return;
    }
    const description = role.title || tr('目前尚無工作', 'No current work');
    focus.innerHTML = '<section class="cockpit-focus-hero">' +
      '<div class="cockpit-focus-top">' +
        '<div class="cockpit-focus-avatar" aria-hidden="true">' + escape(role.icon) + '</div>' +
        '<div class="cockpit-focus-identity"><div class="cockpit-eyebrow">' + tr('目前角色', 'Current role') + '</div>' +
          '<h3>' + escape(role.name) + '</h3><span>' + escape(role.project) + '</span></div>' +
        roleLabel(role) +
      '</div>' +
      '<div class="cockpit-focus-work"><span class="cockpit-eyebrow">' + tr('目前工作', 'Current work') + '</span>' +
        '<p>' + escape(description) + '</p></div>' +
      (role.attention ? '<div class="cockpit-focus-alert">' +
        role.queue + tr(' 項排隊', ' queued') + ' · ' + role.unread + tr(' 則未讀回覆', ' unread replies') + '</div>' : '') +
      '<div class="cockpit-focus-actions">' +
      link(role, tr('繼續對話', 'Open conversation')) +
      link(role, tr('建立新工作', 'New work'), 'new') +
      '</div></section>';
  }

  function renderCommand(data) {
    if (!data.verified) {
      command.innerHTML = '<div class="cockpit-empty cockpit-unavailable">' +
        tr('尚未取得可驗證的 Runtime 狀態。請重新整理；目前不顯示推測的工作數量。', 'Runtime state unavailable. Refresh to check; no counts are estimated.') +
        '</div>';
      return;
    }
    const totals = data.totals;
    const stats = [
      ['working', tr('工作中', 'Working'), totals.working],
      ['waiting', tr('等待處理', 'Waiting'), totals.waiting],
      ['attention', tr('待處理訊息', 'Messages'), totals.attention]
    ].map(([kind, label, count]) =>
      '<div class="cockpit-stat" data-kind="' + kind + '">' +
        '<span>' + label + '</span><strong>' + count + '</strong></div>'
    ).join('');

    const attention = data.attention.length ? data.attention.map(role =>
      '<div class="cockpit-row">' +
        '<div class="cockpit-row-main"><strong>' + escape(role.name) + '</strong>' +
        '<span>' + (role.queue ? role.queue + tr(' 項排隊', ' queued') : '') +
        (role.queue && role.unread ? ' · ' : '') +
        (role.unread ? role.unread + tr(' 則未讀回覆', ' unread replies') : '') + '</span></div>' +
        link(role, tr('前往', 'Open'), 'open') + '</div>'
    ).join('') : '<div class="cockpit-empty">' + tr('目前沒有排隊訊息或未讀回覆。', 'No queued messages or unread replies.') + '</div>';

    const working = data.working.length ? data.working.map(role =>
      '<div class="cockpit-row">' +
        '<div class="cockpit-row-main"><strong>' + escape(role.name) + '</strong>' +
        '<span>' + escape(role.title || tr('執行中', 'Running')) + '</span></div>' +
        link(role, tr('查看', 'View'), 'open') + '</div>'
    ).join('') : '<div class="cockpit-empty">' + tr('目前沒有 Role 正在執行。', 'No Roles are currently working.') + '</div>';

    command.innerHTML = '<div class="cockpit-stats">' + stats + '</div>' +
      '<section class="cockpit-section"><div class="cockpit-section-head">' +
        '<h3>' + tr('待處理', 'Needs attention') + '</h3><span>' + tr('排隊訊息與未讀回覆', 'Queued messages and unread replies') + '</span></div>' +
        '<div class="cockpit-section-body">' + attention + '</div></section>' +
      '<section class="cockpit-section"><div class="cockpit-section-head">' +
        '<h3>' + tr('正在工作', 'Working now') + '</h3><span>' + tr('由 Runtime 即時回報', 'Live Runtime status') + '</span></div>' +
        '<div class="cockpit-section-body">' + working + '</div></section>';
  }

  function render() {
    if (typeof window.getCrewCockpitSnapshot !== 'function') return;
    const snapshot = window.getCrewCockpitSnapshot();
    const data = window.CrewCockpitModel.project(snapshot);
    view.dataset.cockpitMode = mode;
    modeButtons.forEach(button => {
      const active = button.dataset.cockpitMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (statusLine) {
      statusLine.textContent = data.verified
        ? tr('Runtime 已同步', 'Runtime synced') + (data.updatedAt ? ' · ' + timeAgo(data.updatedAt) : '')
        : tr('Runtime 尚未同步 · 狀態未知', 'Runtime unavailable · Unknown status');
      statusLine.dataset.verified = String(data.verified);
    }

    // Do not drop keyboard focus or rebuild panels on unchanged SSE payloads.
    const fingerprint = JSON.stringify({ mode, data, locale: window.getCrewLocale?.() || 'zh-TW' });
    if (fingerprint === lastRenderFingerprint) return;
    lastRenderFingerprint = fingerprint;
    const activeElement = document.activeElement;
    const focusAction = activeElement?.dataset?.cockpitAction;
    const focusRoleId = activeElement?.dataset?.cockpitRoleId;
    renderFocus(data);
    renderCommand(data);
    if (focusAction && focusRoleId) {
      const next = [...view.querySelectorAll('[data-cockpit-action]')].find(button =>
        button.dataset.cockpitAction === focusAction && button.dataset.cockpitRoleId === focusRoleId);
      if (next && typeof next.focus === 'function') next.focus({ preventScroll: true });
    }
  }

  function setMode(next) {
    if (next !== 'command' && next !== 'focus') return;
    mode = next;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
    render();
  }
  modeButtons.forEach(button => button.addEventListener('click',
    () => setMode(button.dataset.cockpitMode)));
  view.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-cockpit-action]');
    if (!actionButton || !view.contains(actionButton)) return;
    const id = actionButton.dataset.cockpitRoleId;
    if (!id || typeof window.openCrewCockpitRole !== 'function') return;
    window.openCrewCockpitRole(id, actionButton.dataset.cockpitAction === 'new');
  });
  document.getElementById('cockpit-refresh-btn')?.addEventListener('click', () => {
    window.loadCrewStatus?.({ force: true }).catch(() => {});
  });
  window.addEventListener('crew:status-updated', render);
  window.addEventListener('crew:role-selected', render);
  window.addEventListener('crew:roster-updated', render);
  document.addEventListener('crew:localechange', render);
  window.CrewCockpit = { setMode, getMode: () => mode, render };
  render();
})();
