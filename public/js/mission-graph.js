/* Mission Graph: read-only Role-to-Role handoff evidence. No inferred tasks. */
(() => {
  'use strict';
  const root = document.getElementById('mission-graph');
  const body = document.getElementById('mission-graph-body');
  const meta = document.getElementById('mission-graph-summary');
  if (!root || !body || !meta) return;

  const tr = (zh, en) => window.getCrewLocale?.() === 'en' ? en : zh;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const idValid = id => /^[A-Za-z0-9._-]{1,160}$/.test(String(id || ''));
  const dateText = time => Number.isFinite(Number(time)) && Number(time) > 0
    ? new Date(Number(time)).toLocaleString(window.getCrewLocale?.() === 'en' ? 'en' : 'zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }) : tr('時間未知', 'Time unavailable');
  const abbreviate = (label, max = 18) => Array.from(String(label ?? '')).slice(0, max).join('') +
    (Array.from(String(label ?? '')).length > max ? '…' : '');

  let currentRole = null;
  let lastFetched = 0;
  let revision = 0;
  let controller = null;
  let lastGraph = null;
  let liveRefreshTimeout = null;
  const currentSnapshot = () => window.getCrewCockpitSnapshot?.();
  let inspectedRoleId = null;
  const activeId = () => inspectedRoleId || String(currentSnapshot()?.activeRoleId || '');

  // The graphic is a hub-and-spoke depiction of *observed messages* only.
  // It does not claim task dependencies, percent completion or approval states.
  function renderRelations(data) {
    const focusId = data.focusRoleId;
    const relations = new Map();
    for (const message of data.events) {
      const otherId = message.fromRoleId === focusId ? message.toRoleId : message.fromRoleId;
      const otherName = message.fromRoleId === focusId ? message.toRoleName : message.fromRoleName;
      const entry = relations.get(otherId) || { name: otherName, outgoing: 0, incoming: 0 };
      if (message.fromRoleId === focusId) entry.outgoing++;
      else entry.incoming++;
      relations.set(otherId, entry);
    }
    const others = [...relations.values()].sort((a,b) =>
      b.incoming + b.outgoing - a.incoming - a.outgoing).slice(0, 6);
    if (!others.length) {
      return '<div class="mission-empty">' +
        tr('目前沒有可呈現的跨角色交接。', 'No recorded Role handoffs in this window.') + '</div>';
    }
    const h = Math.max(145, 38 + others.length * 60);
    const center = Math.round(h / 2);
    const escapedFocus = escape(abbreviate(data.focusRoleName, 12));
    const parts = [
      '<svg class="mission-network" role="img" aria-label="' +
      escape(tr('目前角色與其他角色的已記錄訊息關係', 'Recorded message links between Roles')) +
      '" viewBox="0 0 420 ' + h + '" preserveAspectRatio="xMidYMid meet">',
      '<defs><marker id="mission-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--cp-accent)"/></marker>' +
      '<marker id="mission-arrow-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--cp-live)"/></marker></defs>',
      '<rect x="8" y="' + (center - 28) + '" width="112" height="56" rx="12" class="mission-node-main"/>',
      '<text x="64" y="' + (center - 6) + '" class="mission-svg-caption" text-anchor="middle">' + tr('目前角色', 'Focus Role') + '</text>',
      '<text x="64" y="' + (center + 13) + '" class="mission-svg-name" text-anchor="middle">' + escapedFocus + '</text>'
    ];
    for (let i = 0; i < others.length; i++) {
      const other = others[i];
      const y = 33 + i * 60;
      if (other.outgoing) parts.push(
        '<path class="mission-link-out" d="M120 ' + (center - 5) +
        ' C178 ' + (center - 5) + ', 205 ' + (y - 7) + ', 258 ' + (y - 7) + '" marker-end="url(#mission-arrow)"/>');
      if (other.incoming) parts.push(
        '<path class="mission-link-in" d="M258 ' + (y + 7) +
        ' C202 ' + (y + 7) + ', 176 ' + (center + 7) + ', 120 ' + (center + 7) + '" marker-end="url(#mission-arrow-in)"/>');
      parts.push(
        '<rect x="266" y="' + (y - 24) + '" width="146" height="48" rx="10" class="mission-node-peer"/>',
        '<text x="276" y="' + (y - 3) + '" class="mission-svg-name">' +
          escape(abbreviate(other.name, 16)) + '</text>',
        '<text x="276" y="' + (y + 13) + '" class="mission-svg-caption">' +
          escape((other.outgoing ? tr('送出', 'Out') + ' ' + other.outgoing + '  ' : '') +
            (other.incoming ? tr('收到', 'In') + ' ' + other.incoming : '')) +
        '</text>'
      );
    }
    parts.push('</svg>');
    if (relations.size > 6) parts.push('<div class="mission-note">' +
      escape(tr('還有其他關聯角色，請參考下方時間線。', 'Additional Roles appear in the timeline below.')) + '</div>');
    return parts.join('');
  }

  function renderTimeline(data) {
    if (!data.events.length) return '';
    const available = new Set((currentSnapshot()?.roles || []).map(role => role.id));
    const rows = data.events.map(event => {
      const label = event.kind === 'reply' ? tr('回覆', 'Reply') : tr('交接訊息', 'Handoff');
      const delivery = event.deliveredAt ? tr('已標記交付', 'Marked delivered') :
        tr('未標記交付', 'Not marked delivered');
      const related = event.replyToId
        ? event.linkedReplyId
          ? '<button type="button" class="mission-related" data-mission-jump="' +
              escape(event.linkedReplyId) + '">' + tr('查看原訊息', 'View original') + '</button>'
          : '<span class="mission-note">' +
              tr('原訊息不在最近紀錄範圍內', 'Original outside this window') + '</span>'
        : '';
      const actions = [event.fromRoleId, event.toRoleId]
        .filter((id, i, ids) => ids.indexOf(id) === i && available.has(id))
        .map(id => '<button type="button" class="mission-related" data-mission-open-role="' +
          escape(id) + '">' + tr('前往', 'Open') + ' ' +
          escape(id === event.fromRoleId ? event.fromRoleName : event.toRoleName) + '</button>').join('');
      return '<li class="mission-event" id="mission-event-' + escape(event.id) + '">' +
        '<div class="mission-event-marker" data-kind="' + escape(event.kind) + '" aria-hidden="true"></div>' +
        '<div class="mission-event-content">' +
          '<div class="mission-event-overview"><strong>' + escape(label) + '</strong>' +
            '<time>' + escape(dateText(event.createdAt)) + '</time></div>' +
          '<div class="mission-participants">' + escape(event.fromRoleName) +
            '<span aria-hidden="true">→</span>' + escape(event.toRoleName) + '</div>' +
          '<p>' + escape(event.preview || tr('訊息內容為空', 'Empty message')) + '</p>' +
          '<details class="mission-proof"><summary>' + tr('查看紀錄證據', 'Inspect evidence') + '</summary>' +
            '<div class="mission-proof-body">' +
            '<div>' + tr('訊息 ID', 'Message ID') + '：<code>' + escape(event.id) + '</code></div>' +
            '<div>' + tr('交付狀態', 'Delivery') + '：' + delivery + '</div>' +
            (event.deliveredAt ? '<div>' + tr('交付時間', 'Delivered at') + '：' +
                escape(dateText(event.deliveredAt)) + '</div>' : '') +
            '<div class="mission-event-actions">' + related + actions + '</div>' +
            '</div></details></div></li>';
    });
    return '<section class="mission-timeline-section"><h4>' +
      tr('訊息事件時間線', 'Message event timeline') + '</h4>' +
      '<ol class="mission-timeline">' + rows.join('') + '</ol></section>';
  }

  function renderGraph(data) {
    body.innerHTML = '<div class="mission-legend">' +
      '<span><i class="mission-legend-out"></i>' + tr('角色送出', 'Sent by Role') + '</span>' +
      '<span><i class="mission-legend-in"></i>' + tr('角色收到', 'Received by Role') + '</span>' +
      '</div>' +
      renderRelations(data) +
      '<p class="mission-disclaimer">' +
        tr('圖中連線僅代表已保存的角色訊息，回覆關係以 replyToId 為準；不代表任務依賴或完成進度。',
           'Links show saved messages only. Replies rely on replyToId; no task dependencies or progress are inferred.') +
      '</p>' +
      renderTimeline(data);
    meta.textContent = data.relationCount
      ? data.relationCount + tr(' 則最近訊息', ' recent messages')
      : tr('目前沒有交接紀錄', 'No handoffs recorded');
  }

  async function load({ force = false } = {}) {
    if (!root.open) return;
    const roleId = activeId();
    if (!idValid(roleId)) {
      body.innerHTML = '<div class="mission-empty">' +
        tr('請先選擇 Role。', 'Select a Role first.') + '</div>';
      return;
    }
    if (!force && lastGraph?.focusRoleId === roleId && Date.now() - lastFetched < 8000) return;
    const token = ++revision;
    controller?.abort();
    controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const expected = roleId;
    const cached = lastGraph?.focusRoleId === roleId;
    if (!cached) body.innerHTML = '<div class="mission-empty">' +
      tr('讀取已保存的交接紀錄…', 'Loading saved handoff evidence…') + '</div>';
    try {
      const res = await fetch('/api/mission-graph?role_id=' + encodeURIComponent(roleId), {
        cache: 'no-store', ...(controller ? { signal: controller.signal } : {})
      });
      const data = await res.json();
      if (!res.ok || !data.success || data.focusRoleId !== expected ||
          !Array.isArray(data.events) || !Array.isArray(data.participants)) {
        throw new Error('Unable to verify graph evidence');
      }
      if (token !== revision || activeId() !== expected || !root.open) return;
      lastGraph = data;
      lastFetched = Date.now();
      renderGraph(data);
    } catch (error) {
      if (token !== revision || !root.open) return;
      if (error.name === 'AbortError') return;
      lastGraph = null;
      meta.textContent = tr('無法載入', 'Unavailable');
      body.innerHTML = '<div class="mission-empty mission-error">' +
        tr('目前無法取得交接紀錄，請重新整理後再試。', 'Could not load message evidence. Try refreshing.') +
        '<button type="button" data-mission-refresh>' +
          tr('重新整理', 'Retry') + '</button></div>';
    }
  }

  root.addEventListener('toggle', () => {
    if (root.open) load();
    else { revision++; controller?.abort(); }
  });
  root.addEventListener('click', event => {
    const refresh = event.target.closest('[data-mission-refresh]');
    if (refresh) return load({ force: true });
    const jump = event.target.closest('[data-mission-jump]');
    if (jump) {
      const target = document.getElementById('mission-event-' + jump.dataset.missionJump);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return;
    }
    const role = event.target.closest('[data-mission-open-role]');
    if (role && typeof window.openCrewCockpitRole === 'function') {
      window.openCrewCockpitRole(role.dataset.missionOpenRole);
    }
  });
  window.addEventListener('crew:role-selected', () => {
    inspectedRoleId = null;
    lastFetched = 0;
    if (root.open) load({ force: true });
  });
  window.addEventListener('crew:status-updated', () => {
    if (root.open && Date.now() - lastFetched >= 10000) load();
  });
  document.addEventListener('crew:localechange', () => {
    if (lastGraph && lastGraph.focusRoleId === activeId() && root.open) renderGraph(lastGraph);
  });
  window.CrewMissionGraph = {
    inspectRole(roleId) {
      const available = new Set((currentSnapshot()?.roles || []).map(role => role.id));
      if (!idValid(roleId) || !available.has(roleId)) return;
      inspectedRoleId = roleId;
      lastFetched = 0;
      root.open = true;
      load({ force: true });
      root.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  };
})();
