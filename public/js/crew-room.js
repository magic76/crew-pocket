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
  // All input is resolved into a small allowlist before it reaches SVG markup.
  const OUTFITS = ['engineer', 'researcher', 'planner', 'designer', 'assistant', 'explorer'];
  const ACCESSORIES = ['none', 'glasses', 'headphones', 'cap', 'earpiece'];
  const choice = (value, options, fallback) => options.includes(String(value)) ? String(value) : fallback;
  const variant = (value, count, fallback) => choice(value, Array.from({ length: count }, (_, i) => String(i)), fallback);

  function inferOutfit(role) {
    const roleText = [role?.name, role?.description, role?.projectId].join(' ').toLowerCase();
    if (/research|science|study|data|lab|研究|分析/.test(roleText)) return 'researcher';
    if (/design|art|visual|style|ui|ux|設計|美術/.test(roleText)) return 'designer';
    if (/plan|manage|strategy|lead|product|規劃|管理|指揮/.test(roleText)) return 'planner';
    if (/travel|explor|discover|探索|旅行/.test(roleText)) return 'explorer';
    if (/dev|engineer|code|web|android|backend|frontend|程式|開發/.test(roleText)) return 'engineer';
    return 'assistant';
  }

  function resolvedAvatar(role) {
    const seed = hashId(role?.id || role?.name);
    const settings = role?.avatar && typeof role.avatar === 'object' ? role.avatar : {};
    const outfit = choice(settings.outfit, ['auto', ...OUTFITS], 'auto');
    const resolvedOutfit = outfit === 'auto' ? inferOutfit(role) : outfit;
    const accessory = choice(settings.accessory, ['auto', ...ACCESSORIES], 'auto');
    return {
      seed,
      palette: Number(variant(settings.palette, PALETTES.length, String(seed % PALETTES.length))),
      face: Number(variant(settings.face, 3, String((seed >>> 8) % 3))),
      hair: Number(variant(settings.hair, 6, String((seed >>> 5) % 6))),
      outfit: resolvedOutfit,
      accessory: accessory === 'auto'
        ? (resolvedOutfit === 'engineer' ? 'headphones'
          : resolvedOutfit === 'researcher' ? 'glasses'
          : resolvedOutfit === 'explorer' ? 'cap'
          : (seed % 5 === 0 ? 'glasses' : 'none'))
        : accessory
    };
  }

  // Compact, detailed busts remain legible at 29px in the mobile chat header.
  // Role ID keeps auto-generated attributes deterministic across reloads.
  function portraitMarkup(role) {
    const a = resolvedAvatar(role);
    const p = PALETTES[a.palette];
    const skinShade = a.face === 2 ? '#a66b57' : '#9b624b';
    const parts = [
      '<svg class="crew-role-sprite" viewBox="0 0 32 32" width="40" height="40" shape-rendering="crispEdges" aria-hidden="true" focusable="false" data-avatar-outfit="' + a.outfit + '" data-avatar-accessory="' + a.accessory + '">',
      rect(6, 30, 20, 2, '#45526b'),
      rect(12, 21, 8, 6, p.skin),
      rect(6, 25, 20, 7, p.coat),
      rect(3, 28, 6, 4, p.coat),
      rect(23, 28, 6, 4, p.coat),
      rect(4, 30, 3, 2, p.skin, 'crew-pixel-hand'),
      rect(25, 30, 3, 2, p.skin, 'crew-pixel-hand'),
      rect(9, 24, 14, 2, p.accent),
      rect(10, 9, 12, 12, p.skin)
    ];
    if (a.face === 0) parts.push(rect(9, 12, 2, 7, p.skin), rect(21, 12, 2, 7, p.skin));
    if (a.face === 1) parts.push(rect(8, 12, 3, 9, p.skin), rect(21, 12, 3, 9, p.skin));
    if (a.face === 2) parts.push(rect(11, 20, 10, 3, p.skin), rect(9, 12, 2, 7, p.skin), rect(21, 12, 2, 7, p.skin));
    parts.push(
      rect(9, 18, 2, 3, skinShade), rect(21, 18, 2, 3, skinShade),
      rect(13, 16, 2, 2, '#253046', 'crew-avatar-eye'),
      rect(19, 16, 2, 2, '#253046', 'crew-avatar-eye'),
      rect(15, 21, 3, 1, '#9f5a58')
    );
    // Six visibly different silhouettes, rather than recolors of one haircut.
    if (a.hair === 0) parts.push(rect(8, 6, 16, 5, p.hair), rect(8, 10, 3, 5, p.hair));
    if (a.hair === 1) parts.push(rect(8, 7, 16, 4, p.hair), rect(10, 5, 9, 3, p.hair), rect(22, 9, 3, 7, p.hair));
    if (a.hair === 2) parts.push(rect(9, 8, 14, 3, p.hair), rect(12, 6, 9, 3, p.hair), rect(8, 11, 3, 7, p.hair));
    if (a.hair === 3) parts.push(rect(8, 7, 16, 5, p.hair), rect(7, 11, 3, 12, p.hair), rect(22, 11, 3, 12, p.hair));
    if (a.hair === 4) parts.push(rect(9, 9, 14, 2, p.hair), rect(12, 7, 8, 2, p.hair));
    if (a.hair === 5) parts.push(rect(7, 8, 18, 4, p.hair), rect(9, 5, 5, 4, p.hair), rect(17, 5, 6, 4, p.hair), rect(23, 11, 2, 5, p.hair));
    if (a.outfit === 'engineer') parts.push(rect(15, 26, 2, 6, '#27384f'), rect(11, 27, 2, 2, p.accent));
    if (a.outfit === 'researcher') parts.push(rect(9, 25, 4, 7, '#eff1e5'), rect(19, 25, 4, 7, '#eff1e5'), rect(15, 27, 2, 4, '#4c8098'));
    if (a.outfit === 'planner') parts.push(rect(12, 26, 3, 6, '#29344f'), rect(18, 26, 3, 6, '#29344f'), rect(15, 26, 3, 4, '#dcb673'));
    if (a.outfit === 'designer') parts.push(rect(9, 28, 4, 2, '#f3c36d'), rect(20, 26, 3, 5, '#a9dbdd'));
    if (a.outfit === 'assistant') parts.push(rect(13, 27, 6, 2, p.accent), rect(14, 30, 4, 1, '#37465e'));
    if (a.outfit === 'explorer') parts.push(rect(10, 26, 12, 2, '#745341'), rect(15, 26, 2, 6, '#e0bb70'));
    if (a.accessory === 'glasses') parts.push(
      rect(11, 15, 6, 1, '#394458'), rect(18, 15, 5, 1, '#394458'), rect(16, 16, 3, 1, '#394458')
    );
    if (a.accessory === 'headphones') parts.push(
      rect(7, 10, 2, 10, '#35465e'), rect(23, 10, 2, 10, '#35465e'),
      rect(9, 5, 14, 2, '#35465e'), rect(6, 15, 3, 5, p.accent), rect(23, 15, 3, 5, p.accent)
    );
    if (a.accessory === 'cap') parts.push(
      rect(8, 5, 16, 5, p.coat), rect(7, 9, 19, 2, p.accent)
    );
    if (a.accessory === 'earpiece') parts.push(
      rect(23, 16, 3, 4, '#344153'), rect(23, 21, 2, 1, p.accent)
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

  return { portraitMarkup, resolvedAvatar, inferOutfit, planNewEvents, activityRows, activityMarkup, init };
});
