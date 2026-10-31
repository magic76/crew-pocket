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

  // 48×48 chibi portrait. The larger grid improves facial details while
  // deliberately keeping bold 2–4px shapes for 29px mobile header rendering.
  // Rendering remains deterministic and uses only allowlisted colors/options.
  function portraitMarkup(role) {
    const a = resolvedAvatar(role);
    const p = PALETTES[a.palette];
    const shade = ['#d9977c', '#a76d58', '#c78b72', '#945c48', '#d5a88c', '#b87e63'][a.palette];
    const blush = ['#e89f99', '#ad7069', '#e39a93', '#a96365', '#e9b0a3', '#c98783'][a.palette];
    const shine = ['#ffe0c0', '#e0a17d', '#ffd6b2', '#d39d78', '#ffebd1', '#efba98'][a.palette];
    const line = '#27354d';
    const parts = [
      '<svg class="crew-role-sprite" viewBox="0 0 48 48" width="48" height="48" shape-rendering="crispEdges" aria-hidden="true" focusable="false" data-avatar-outfit="' + a.outfit + '" data-avatar-accessory="' + a.accessory + '">',
      // Rounded, short torso and tiny hands: head occupies ~60% of portrait.
      rect(12, 46, 24, 2, '#47546b'),
      rect(9, 39, 30, 9, p.coat),
      rect(6, 42, 8, 6, p.coat),
      rect(34, 42, 8, 6, p.coat),
      rect(7, 45, 5, 3, p.skin, 'crew-pixel-hand'),
      rect(36, 45, 5, 3, p.skin, 'crew-pixel-hand'),
      rect(19, 33, 10, 7, shade),
      rect(20, 33, 8, 5, p.skin),
      rect(15, 37, 18, 4, p.accent)
    ];

    // Long hair falls behind the head instead of hiding the big eyes.
    if (a.hair === 3) parts.push(
      rect(9, 12, 30, 25, p.hair), rect(8, 20, 6, 20, p.hair),
      rect(34, 20, 6, 20, p.hair), rect(10, 36, 5, 5, p.hair),
      rect(33, 36, 5, 5, p.hair)
    );

    // Face silhouettes are distinct: round / square / tapered.
    if (a.face === 0) parts.push(
      rect(14, 10, 20, 27, shade, 'crew-avatar-face'),
      rect(11, 14, 26, 19, shade),
      rect(13, 11, 22, 24, p.skin),
      rect(12, 16, 24, 16, p.skin),
      rect(16, 35, 16, 2, p.skin)
    );
    if (a.face === 1) parts.push(
      rect(11, 11, 26, 25, shade, 'crew-avatar-face'),
      rect(12, 10, 24, 24, p.skin),
      rect(12, 30, 24, 5, p.skin),
      rect(14, 35, 20, 2, shade)
    );
    if (a.face === 2) parts.push(
      rect(12, 12, 24, 21, shade, 'crew-avatar-face'),
      rect(14, 31, 20, 4, shade),
      rect(13, 12, 22, 19, p.skin),
      rect(15, 30, 18, 4, p.skin),
      rect(18, 34, 12, 3, p.skin)
    );

    // Little ears, big expressive eyes, pastel cheek pixels and small mouth.
    parts.push(
      rect(9, 23, 3, 6, p.skin), rect(36, 23, 3, 6, p.skin),
      rect(13, 28, 4, 2, blush),
      rect(31, 28, 4, 2, blush),
      rect(17, 22, 4, 5, line, 'crew-avatar-eye'),
      rect(27, 22, 4, 5, line, 'crew-avatar-eye'),
      rect(18, 22, 1, 2, '#ffffff'),
      rect(28, 22, 1, 2, '#ffffff'),
      rect(22, 31, 4, 1, '#a55e67'),
      rect(20, 17, 8, 1, shine)
    );

    // Six expressive silhouettes; wider crowns and larger bangs read at 32px.
    if (a.hair === 0) parts.push(
      rect(11, 8, 26, 7, p.hair), rect(14, 6, 19, 4, p.hair),
      rect(10, 13, 5, 9, p.hair), rect(33, 13, 5, 7, p.hair),
      rect(15, 14, 11, 5, p.hair), rect(15, 7, 11, 2, p.accent)
    );
    if (a.hair === 1) parts.push(
      rect(11, 9, 27, 6, p.hair), rect(15, 6, 21, 5, p.hair),
      rect(10, 13, 5, 9, p.hair), rect(31, 13, 7, 5, p.hair),
      rect(15, 14, 18, 4, p.hair), rect(15, 9, 9, 2, p.accent)
    );
    if (a.hair === 2) parts.push(
      rect(10, 8, 28, 7, p.hair), rect(13, 5, 8, 6, p.hair),
      rect(23, 5, 10, 6, p.hair), rect(8, 12, 7, 10, p.hair),
      rect(33, 12, 7, 9, p.hair), rect(14, 14, 16, 4, p.hair),
      rect(16, 7, 4, 2, p.accent)
    );
    if (a.hair === 3) parts.push(
      rect(11, 8, 26, 8, p.hair), rect(14, 6, 20, 5, p.hair),
      rect(10, 13, 6, 10, p.hair), rect(32, 13, 6, 10, p.hair),
      rect(15, 14, 10, 5, p.hair), rect(17, 8, 7, 2, p.accent)
    );
    if (a.hair === 4) parts.push(
      rect(14, 10, 20, 4, p.hair), rect(17, 8, 14, 3, p.hair),
      rect(12, 14, 3, 5, p.hair), rect(33, 14, 3, 5, p.hair),
      rect(18, 9, 8, 1, p.accent)
    );
    if (a.hair === 5) parts.push(
      rect(10, 9, 28, 7, p.hair), rect(10, 5, 9, 8, p.hair),
      rect(20, 4, 10, 9, p.hair), rect(31, 6, 9, 9, p.hair),
      rect(8, 13, 7, 10, p.hair), rect(34, 13, 7, 10, p.hair),
      rect(18, 13, 8, 6, p.hair), rect(21, 6, 5, 2, p.accent)
    );

    // Professional identity is visible from the collar/chest, not just hue.
    if (a.outfit === 'engineer') parts.push(
      rect(15, 39, 18, 3, '#35455e'), rect(21, 41, 6, 7, '#28374c'),
      rect(13, 42, 5, 5, p.accent), rect(15, 43, 2, 2, '#ffffff')
    );
    if (a.outfit === 'researcher') parts.push(
      rect(12, 39, 9, 9, '#f1f5ef'), rect(27, 39, 9, 9, '#f1f5ef'),
      rect(21, 40, 6, 8, '#4d869c'),
      rect(14, 42, 4, 2, '#9dc6cb'), rect(29, 42, 4, 2, '#9dc6cb')
    );
    if (a.outfit === 'planner') parts.push(
      rect(15, 39, 18, 3, '#34445e'), rect(22, 40, 4, 8, '#efbf73'),
      rect(21, 40, 6, 2, '#fff1c8'), rect(32, 43, 3, 3, '#f5d384')
    );
    if (a.outfit === 'designer') parts.push(
      rect(13, 40, 22, 3, '#f3bd81'), rect(15, 43, 6, 4, '#f2a65f'),
      rect(29, 42, 4, 6, '#a8e3e8'), rect(31, 40, 2, 4, '#f9d58d')
    );
    if (a.outfit === 'assistant') parts.push(
      rect(18, 40, 12, 3, p.accent), rect(21, 44, 6, 3, '#3c506b'),
      rect(23, 43, 2, 2, '#ffffff')
    );
    if (a.outfit === 'explorer') parts.push(
      rect(12, 40, 24, 3, '#be985a'), rect(15, 39, 5, 9, '#7d5e42'),
      rect(30, 39, 5, 9, '#7d5e42'), rect(23, 44, 4, 4, '#e8c877')
    );

    // Accessories sit on top and are intentionally chunky for mobile use.
    if (a.accessory === 'glasses') parts.push(
      rect(14, 21, 10, 2, '#33445c'), rect(25, 21, 10, 2, '#33445c'),
      rect(14, 23, 2, 5, '#33445c'), rect(22, 23, 2, 5, '#33445c'),
      rect(25, 23, 2, 5, '#33445c'), rect(33, 23, 2, 5, '#33445c'),
      rect(23, 22, 3, 2, '#33445c')
    );
    if (a.accessory === 'headphones') parts.push(
      rect(8, 13, 4, 14, line), rect(36, 13, 4, 14, line),
      rect(11, 6, 26, 3, line), rect(7, 19, 5, 9, p.accent),
      rect(36, 19, 5, 9, p.accent), rect(9, 21, 2, 5, '#ffffff'),
      rect(37, 21, 2, 5, '#ffffff')
    );
    if (a.accessory === 'cap') parts.push(
      rect(10, 7, 28, 7, p.coat), rect(14, 4, 20, 4, p.coat),
      rect(8, 13, 32, 3, p.accent), rect(17, 8, 12, 2, p.accent)
    );
    if (a.accessory === 'earpiece') parts.push(
      rect(37, 22, 5, 7, line), rect(39, 24, 3, 3, p.accent),
      rect(35, 30, 5, 2, line), rect(33, 31, 3, 2, p.accent)
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
