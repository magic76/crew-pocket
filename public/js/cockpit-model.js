/* Pure Crew Cockpit projection. No progress inference and no fabricated decisions. */
(function (root, make) {
  'use strict';
  const api = make();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewCockpitModel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const STATES = new Set(['working', 'waiting', 'idle', 'new']);
  const positive = value => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;

  function project(snapshot) {
    const roles = Array.isArray(snapshot?.roles) ? snapshot.roles : [];
    const verified = snapshot?.verified === true;
    const items = roles.map(role => {
      const status = verified ? role.status : null;
      const state = status ? (STATES.has(status.state) ? status.state : 'unknown') : 'unknown';
      const queue = status ? positive(status.queuedMessageCount) + positive(status.queuedRequestCount) : 0;
      const unread = status ? positive(status.unreadReplyCount) : 0;
      const title = status?.currentWork?.title || status?.conversationTitle || role.latestTitle || '';
      return {
        id: String(role.id || ''),
        name: String(role.name || 'Role'),
        project: String(role.project || ''),
        icon: String(role.icon || '●'),
        state, busy: status?.busy === true,
        queue, unread, attention: queue + unread,
        title: String(title),
        lastActivityAt: positive(status?.lastActivityAt || role.latestUpdatedAt),
        isSelected: role.id === snapshot?.activeRoleId
      };
    }).filter(role => role.id);
    const active = items.find(role => role.isSelected) || items[0] || null;
    const totals = verified ? {
      working: items.filter(role => role.state === 'working').length,
      waiting: items.filter(role => role.state === 'waiting').length,
      attention: items.reduce((total, item) => total + item.attention, 0),
      roles: items.length
    } : null;
    const attention = verified ? items.filter(role => role.attention).sort((a, b) =>
      b.attention - a.attention || a.name.localeCompare(b.name)) : [];
    const working = verified ? items.filter(role => role.state === 'working')
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt) : [];
    return {
      verified, updatedAt: positive(snapshot?.updatedAt),
      roles: items, active, totals, attention, working
    };
  }
  return { project };
});
