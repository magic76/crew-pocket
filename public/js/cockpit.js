/* Crew Home compact coordination strip: verified attention only, not a second cockpit. */
(() => {
  'use strict';
  const host = document.getElementById('crew-attention-panel');
  const statusLine = document.getElementById('cockpit-status-line');
  const refresh = document.getElementById('cockpit-refresh-btn');
  if (!host || !window.CrewCockpitModel) return;

  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const tr = (zh, en) => window.getCrewLocale?.() === 'en' ? en : zh;
  let lastAttention = null;

  function render() {
    if (typeof window.getCrewCockpitSnapshot !== 'function') return;
    const data = window.CrewCockpitModel.project(window.getCrewCockpitSnapshot());
    if (statusLine) {
      statusLine.textContent = data.verified
        ? tr('Runtime 已同步', 'Runtime synced')
        : tr('Runtime 尚未同步，狀態未知', 'Runtime unavailable; status unknown');
      statusLine.dataset.verified = String(data.verified);
    }
    const attention = data.verified ? data.attention : [];
    const html = attention.length ? '<section class="crew-attention-card">' +
      '<div class="crew-attention-head"><strong>' + tr('待你處理', 'Needs your attention') + '</strong>' +
        '<span>' + data.totals.attention + tr(' 則訊息', ' messages') + '</span></div>' +
      attention.slice(0, 4).map(role =>
        '<button type="button" class="crew-attention-row" data-crew-attention-role="' + escape(role.id) + '">' +
          '<span class="crew-attention-dot" aria-hidden="true"></span>' +
          '<span><strong>' + escape(role.name) + '</strong>' +
            '<small>' + (role.queue ? role.queue + tr(' 項排隊', ' queued') : '') +
              (role.queue && role.unread ? ' · ' : '') +
              (role.unread ? role.unread + tr(' 則未讀', ' unread') : '') +
            '</small></span>' +
          '<span class="crew-attention-chevron" aria-hidden="true">›</span></button>').join('') +
      (attention.length > 4 ? '<p class="crew-home-footnote">' +
        tr('其他待處理成員請見下方角色卡片', 'Additional updates appear on Role cards') +
        '</p>' : '') +
      '</section>' : '';
    if (lastAttention !== html) {
      const focused = document.activeElement?.dataset?.crewAttentionRole;
      host.innerHTML = html;
      lastAttention = html;
      if (focused) {
        const next = [...host.querySelectorAll('[data-crew-attention-role]')]
          .find(item => item.dataset.crewAttentionRole === focused);
        next?.focus?.({ preventScroll: true });
      }
    }
  }
  host.addEventListener('click', event => {
    const button = event.target.closest('[data-crew-attention-role]');
    if (!button || !host.contains(button)) return;
    window.openCrewCockpitRole?.(button.dataset.crewAttentionRole);
  });
  refresh?.addEventListener('click', () => {
    window.loadCrewStatus?.({ force: true }).catch(() => {});
  });
  window.addEventListener('crew:status-updated', render);
  window.addEventListener('crew:role-selected', render);
  window.addEventListener('crew:roster-updated', render);
  document.addEventListener('crew:localechange', render);
  window.CrewCockpit = { render };
  render();
})();
