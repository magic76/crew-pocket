/* Crew Room portraits + evidence-only handoff animation.
 * Presentation only: no Role, Context, Memory or queue mutations. */
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

  function init(win, doc) {
    if (!win || !doc || typeof win.fetch !== 'function') return;
    const stage = doc.getElementById('crew-room-roster-stage');
    const roster = doc.getElementById('role-nav-list');
    const flights = doc.getElementById('crew-room-handoffs');
    if (!stage || !roster || !flights) return;

    let seenIds = null;
    let pendingTimer = null;
    let lastRequestAt = 0;
    let inFlight = false;
    const isVisible = () => !doc.hidden && doc.body?.dataset?.primaryTab === 'crew';

    function fly(event) {
      if (!isVisible() || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const cards = [...roster.querySelectorAll('[data-role-card-id]')];
      const from = cards.find(card => card.dataset.roleCardId === event.fromRoleId);
      const to = cards.find(card => card.dataset.roleCardId === event.toRoleId);
      if (!from || !to) return;
      const area = stage.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const sx = a.left + a.width / 2 - area.left;
      const sy = a.top + Math.min(39, a.height / 3) - area.top;
      const tx = b.left + b.width / 2 - area.left;
      const ty = b.top + Math.min(39, b.height / 3) - area.top;
      if (![sx, sy, tx, ty].every(Number.isFinite)) return;
      const envelope = doc.createElement('span');
      envelope.className = 'crew-room-envelope';
      envelope.setAttribute('aria-hidden', 'true');
      envelope.textContent = '✉';
      envelope.style.left = sx + 'px';
      envelope.style.top = sy + 'px';
      envelope.style.setProperty('--crew-fly-x', (tx - sx) + 'px');
      envelope.style.setProperty('--crew-fly-y', (ty - sy) + 'px');
      envelope.style.setProperty('--crew-mid-x', ((tx - sx) / 2) + 'px');
      envelope.style.setProperty('--crew-mid-y', ((ty - sy) / 2 - 22) + 'px');
      flights.appendChild(envelope);
      const cleanup = () => envelope.remove();
      envelope.addEventListener('animationend', cleanup, { once: true });
      win.setTimeout(cleanup, 1500);
      to.classList.add('crew-handoff-arrived');
      win.setTimeout(() => to.classList.remove('crew-handoff-arrived'), 1100);
    }

    async function synchronize() {
      pendingTimer = null;
      if (!isVisible() || inFlight) return;
      inFlight = true;
      lastRequestAt = Date.now();
      try {
        const response = await win.fetch('/api/crew-room-events', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!data.success || !Array.isArray(data.events)) return;
        const next = planNewEvents(data.events, seenIds);
        seenIds = next.seenIds;
        if (isVisible()) next.arrivals.forEach(fly);
      } catch (_) {
        // Runtime unavailable: no speculative delivery animation.
      } finally {
        inFlight = false;
      }
    }

    function schedule() {
      if (!isVisible() || pendingTimer !== null) return;
      pendingTimer = win.setTimeout(synchronize, Math.max(120, 2500 - (Date.now() - lastRequestAt)));
    }

    win.addEventListener('crew:status-updated', schedule);
    win.addEventListener('crew:roster-updated', schedule);
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) seenIds = null;
      else schedule();
    });
    // Initial state is a baseline, not a stream of fake historical handoffs.
    schedule();
  }

  return { portraitMarkup, planNewEvents, init };
});
