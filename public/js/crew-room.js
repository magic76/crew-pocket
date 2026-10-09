/* Crew Room: stable Role portraits and evidence-only collaboration activity.
 * No simulated office, queue changes, memory sharing or inferred success. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewRoomVisual = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const PALETTES = [
    { skin: '#f0bf94', hair: '#413246', coat: '#6e75cb', accent: '#c5d7ff' },
    { skin: '#c58c69', hair: '#242c46', coat: '#368f86', accent: '#91e4c7' },
    { skin: '#e7b38c', hair: '#ad6250', coat: '#af6b9b', accent: '#f6c8ec' },
    { skin: '#b87856', hair: '#342335', coat: '#c58c48', accent: '#ffe3a6' },
    { skin: '#efcbab', hair: '#786249', coat: '#4c87a9', accent: '#b3e6ff' },
    { skin: '#d8a07a', hair: '#343638', coat: '#8c6ca3', accent: '#d8c6fa' }
  ];
  function hashId(value) {
    let hash = 2166136261;
    for (const char of String(value || 'role')) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  const rect = (x, y, w, h, fill, classes = '') =>
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
    '" fill="' + fill + '"' + (classes ? ' class="' + classes + '"' : '') + '/>';

  // Original, procedurally generated pixel people: no third-party art assets.
  function portraitMarkup(role) {
    const seed = hashId(role && role.id);
    const p = PALETTES[seed % PALETTES.length];
    const hair = seed % 3;
    const glasses = seed % 4 === 0;
    const parts = [
      '<svg class="crew-role-sprite" viewBox="0 0 32 32" width="40" height="40" shape-rendering="crispEdges" aria-hidden="true" focusable="false">',
      rect(5, 29, 22, 2, '#536176'),
      rect(11, 23, 4, 7, '#354357'),
      rect(18, 23, 4, 7, '#354357'),
      rect(10, 20, 13, 9, p.coat),
      rect(14, 21, 4, 8, p.accent),
      rect(7, 22, 3, 6, p.coat),
      rect(23, 22, 3, 6, p.coat),
      rect(7, 26, 3, 2, p.skin, 'crew-pixel-hand'),
      rect(23, 26, 3, 2, p.skin, 'crew-pixel-hand'),
      rect(10, 9, 13, 12, p.skin),
      rect(10, 17, 2, 3, '#9b624b'),
      rect(21, 17, 2, 3, '#9b624b'),
      rect(13, 15, 2, 2, '#252b39'),
      rect(19, 15, 2, 2, '#252b39'),
      rect(15, 19, 3, 1, '#995c57'),
      rect(9, 7, 15, 4, p.hair),
      rect(9, 11, 2, hair === 0 ? 6 : 3, p.hair),
      rect(22, 11, 2, hair === 1 ? 6 : 3, p.hair)
    ];
    if (hair === 2) parts.push(rect(13, 6, 7, 2, p.hair), rect(11, 8, 3, 4, p.hair));
    if (glasses) parts.push(
      rect(12, 14, 5, 1, '#46505e'), rect(18, 14, 5, 1, '#46505e'),
      rect(16, 15, 3, 1, '#46505e')
    );
    parts.push('</svg>');
    return parts.join('');
  }

  // Seed from history, then animate only fresh, newly observed, persisted events.
  function planNewEvents(events, previousIds, now = Date.now()) {
    if (!Array.isArray(events)) return { seenIds: previousIds, arrivals: [] };
    const present = events.filter(event => event && typeof event.id === 'string');
    const currentIds = new Set(present.map(event => event.id));
    if (previousIds === null) return { seenIds: currentIds, arrivals: [] };
    const arrivals = present.filter(event => (
      !previousIds.has(event.id) &&
      event.fromRoleId && event.toRoleId && event.fromRoleId !== event.toRoleId &&
      Number.isFinite(event.createdAt) &&
      event.createdAt > 0 && now - event.createdAt >= -5000 &&
      now - event.createdAt <= 45000
    )).slice(0, 3).reverse();
    return { seenIds: currentIds, arrivals };
  }

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  // The room endpoint returns saved *message metadata*, not delivery results.
  // Only display actual records between currently known Role identities.
  function activityRows(events, roles, limit = 5) {
    const names = new Map((Array.isArray(roles) ? roles : [])
      .filter(role => role && typeof role.id === 'string')
      .map(role => [role.id, String(role.name || 'Role')]));
    const seen = new Set();
    return (Array.isArray(events) ? events : [])
      .filter(event => {
        if (!event || typeof event.id !== 'string' || !event.id || seen.has(event.id) ||
            event.fromRoleId === event.toRoleId ||
            !names.has(event.fromRoleId) || !names.has(event.toRoleId) ||
            !Number.isFinite(event.createdAt) || event.createdAt <= 0 ||
            event.createdAt > Date.now() + 5000) return false;
        seen.add(event.id);
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(0, Math.min(8, limit)))
      .map(event => ({
        id: event.id,
        fromRoleId: event.fromRoleId,
        toRoleId: event.toRoleId,
        fromName: names.get(event.fromRoleId),
        toName: names.get(event.toRoleId),
        kind: event.kind === 'reply' ? 'reply' : 'handoff',
        createdAt: event.createdAt
      }));
  }

  function activityMarkup(entries, locale = 'zh-TW', emptyMessage = '') {
    if (!entries.length) return '<p class="crew-activity-empty">' +
      escapeHtml(emptyMessage || '目前沒有角色間的協作紀錄') + '</p>';
    const english = String(locale).toLowerCase().startsWith('en');
    const formatter = new Intl.DateTimeFormat(english ? 'en-US' : 'zh-TW', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    return entries.map(entry => {
      const description = entry.kind === 'reply'
        ? (english ? 'Reply recorded' : '已記錄回覆')
        : (english ? 'Handoff recorded' : '已記錄交接');
      const timestamp = formatter.format(new Date(entry.createdAt));
      return '<button type="button" class="crew-activity-row" data-crew-activity-role="' +
        escapeHtml(entry.toRoleId) + '" aria-label="' +
        escapeHtml(entry.fromName + ' → ' + entry.toName + ' · ' + description) + '">' +
        '<span class="crew-activity-symbol" aria-hidden="true">' +
          (entry.kind === 'reply' ? '↩' : '↗') + '</span>' +
        '<span class="crew-activity-main">' +
          '<span class="crew-activity-route"><strong>' + escapeHtml(entry.fromName) +
          '</strong><span aria-hidden="true"> → </span><strong>' +
            escapeHtml(entry.toName) + '</strong></span>' +
          '<span class="crew-activity-kind">' + description + '</span>' +
        '</span>' +
        '<time class="crew-activity-time" datetime="' +
          new Date(entry.createdAt).toISOString() + '">' + escapeHtml(timestamp) + '</time>' +
        '<span class="crew-activity-chevron" aria-hidden="true">›</span>' +
      '</button>';
    }).join('');
  }

  function init(win, doc) {
    if (!win || !doc || typeof win.fetch !== 'function') return;
    const roster = doc.getElementById('role-nav-list');
    const activity = doc.getElementById('crew-activity-list');
    if (!roster || !activity) return;

    let seenIds = null;
    let cachedEvents = null;
    let lastMarkup = null;
    let previouslyVerified = false;
    let previousStates = new Map();
    let pendingTimer = null;
    let lastRequestAt = 0;
    let inFlight = false;
    const visible = () => !doc.hidden && doc.body?.dataset?.primaryTab === 'crew';
    const locale = () => win.getCrewLocale?.() || 'zh-TW';
    const roles = () => win.getCrewCockpitSnapshot?.()?.roles || [];

    function showActivity(error = false) {
      if (!visible()) return;
      const entries = activityRows(cachedEvents, roles());
      const blank = error ? '暫時無法取得協作紀錄'
        : cachedEvents === null ? '正在載入協作紀錄…'
        : !roles().length ? '等待小隊成員資料同步…'
        : '目前沒有角色間的協作紀錄';
      const markup = activityMarkup(error ? [] : entries, locale(), blank);
      if (markup !== lastMarkup) {
        const focusedRole = doc.activeElement?.dataset?.crewActivityRole;
        activity.innerHTML = markup;
        lastMarkup = markup;
        if (focusedRole) {
          [...activity.querySelectorAll('[data-crew-activity-role]')]
            .find(node => node.dataset.crewActivityRole === focusedRole)
            ?.focus?.({ preventScroll: true });
        }
      }
    }

    function reflectWorkTransitions() {
      const snapshot = win.getCrewCockpitSnapshot?.();
      if (!snapshot?.verified) {
        previouslyVerified = false;
        previousStates.clear();
        return;
      }
      const next = new Map((snapshot.roles || []).map(role => [
        String(role.id), String(role.status?.state || 'unknown')
      ]));
      if (previouslyVerified && visible() &&
          !win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        for (const card of roster.querySelectorAll('[data-role-card-id]')) {
          if (previousStates.get(card.dataset.roleCardId) !== 'working' ||
              !['idle', 'waiting'].includes(next.get(card.dataset.roleCardId))) continue;
          // Stopping work is not proof of task success.
          card.classList.add('crew-work-settled');
          win.setTimeout(() => card.classList.remove('crew-work-settled'), 950);
        }
      }
      previousStates = next;
      previouslyVerified = true;
    }

    function emphasizeNewHandoffs(arrivals) {
      if (!visible() || win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
      for (const event of arrivals) {
        const card = [...roster.querySelectorAll('[data-role-card-id]')]
          .find(node => node.dataset.roleCardId === event.toRoleId);
        if (!card) continue;
        card.classList.add('crew-handoff-arrived');
        win.setTimeout(() => card.classList.remove('crew-handoff-arrived'), 950);
      }
    }

    async function synchronize() {
      pendingTimer = null;
      if (!visible() || inFlight) return;
      inFlight = true;
      lastRequestAt = Date.now();
      try {
        const response = await win.fetch('/api/crew-room-events', { cache: 'no-store' });
        if (!response.ok) throw new Error('Crew activity unavailable');
        const data = await response.json();
        if (!data.success || !Array.isArray(data.events)) throw new Error('Invalid crew activity');
        const next = planNewEvents(data.events, seenIds);
        seenIds = next.seenIds;
        cachedEvents = data.events;
        if (visible()) {
          showActivity();
          emphasizeNewHandoffs(next.arrivals);
          // Cosmetic consumers only receive fresh, saved handoff metadata.
          // No message bodies, memory, fabricated steps or provider changes.
          if (win.getCrewCockpitSnapshot?.()?.verified === true) {
            for (const event of next.arrivals) {
              win.dispatchEvent?.(new win.CustomEvent('crew:handoff-observed', {
                detail: {
                  id: event.id,
                  fromRoleId: event.fromRoleId,
                  toRoleId: event.toRoleId,
                  createdAt: event.createdAt
                }
              }));
            }
          }
        }
      } catch (_) {
        if (visible()) showActivity(true);
      } finally {
        inFlight = false;
      }
    }

    function schedule() {
      if (!visible() || pendingTimer !== null) return;
      pendingTimer = win.setTimeout(synchronize,
        Math.max(120, 2500 - (Date.now() - lastRequestAt)));
    }

    activity.addEventListener('click', event => {
      const row = event.target.closest?.('[data-crew-activity-role]');
      if (!row) return;
      // Open the receiver's existing scoped collaboration history; never send
      // sender context or share a project/workspace through this interaction.
      const roleId = row.dataset.crewActivityRole;
      if (roles().some(role => role.id === roleId)) {
        win.openCrewCollaboration?.(roleId);
      }
    });
    const onUpdate = () => {
      reflectWorkTransitions();
      showActivity();
      schedule();
    };
    win.addEventListener('crew:status-updated', onUpdate);
    win.addEventListener('crew:roster-updated', onUpdate);
    doc.addEventListener('crew:localechange', () => showActivity());
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) seenIds = null;
      else { showActivity(); schedule(); }
    });
    if (win.MutationObserver) new win.MutationObserver(() => {
      if (visible()) { seenIds = null; showActivity(); schedule(); }
      else seenIds = null;
    }).observe(doc.body, { attributes: true, attributeFilter: ['data-primary-tab'] });
    schedule();
    return { synchronize, showActivity };
  }

  return { portraitMarkup, planNewEvents, activityRows, activityMarkup, init };
});
