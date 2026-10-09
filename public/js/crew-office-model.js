/* Pure projection for the touch-first Crew Office. No runtime mutation. */
(function (root, make) {
  'use strict';
  const api = make();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewOfficeModel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const STATES = new Set(['working', 'waiting', 'idle', 'new']);
  const safeCount = value => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const stateLabel = (state, english = false) => ({
    working: english ? 'Working' : '工作中',
    waiting: english ? 'Needs attention' : '等待處理',
    idle: english ? 'Available' : '待命',
    new: english ? 'New' : '新角色',
    unknown: english ? 'Not synced' : '尚未同步'
  })[state] || (english ? 'Not synced' : '尚未同步');

  function specialty(role) {
    const label = [role.project, role.name].join(' ').toLowerCase();
    if (/teacher|教學|老師/.test(label)) return 'teacher';
    if (/story|故事/.test(label)) return 'story';
    if (/fortune|命理|星盤/.test(label)) return 'fortune';
    return 'developer';
  }

  function project(snapshot) {
    const verified = snapshot?.verified === true;
    const found = new Set();
    const roles = (Array.isArray(snapshot?.roles) ? snapshot.roles : [])
      .filter(role => role && typeof role.id === 'string' && role.id && !found.has(role.id) && found.add(role.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(role => {
        const status = verified && role.status && typeof role.status === 'object' ? role.status : null;
        const reported = status && STATES.has(status.state) ? status.state : 'unknown';
        // An internally contradictory Runtime status must not animate
        // work unless its busy flag actually confirms work is in progress.
        const state = reported === 'working' && status.busy !== true ? 'unknown' : reported;
        const attention = status
          ? safeCount(status.queuedMessageCount) + safeCount(status.queuedRequestCount) +
            safeCount(status.unreadReplyCount) : 0;
        return {
          id: role.id, name: String(role.name || 'Role'),
          kind: specialty(role), state, attention,
          selected: String(snapshot.activeRoleId || '') === role.id,
          // Historical conversation titles never become a fake live task.
          title: String(status?.currentWork?.title || status?.conversationTitle || ''),
          // Never infer "busy" from a stale title or historical conversation.
          busy: state === 'working' && status?.busy === true
        };
      });
    return {
      verified,
      roles,
      attention: verified ? roles.reduce((sum, role) => sum + role.attention, 0) : null,
      working: verified ? roles.filter(role => role.busy).length : null
    };
  }

  function planHandoff(event, room, now = Date.now()) {
    if (!room?.verified || !event || !Array.isArray(room.roles)) return null;
    const { id, fromRoleId, toRoleId, createdAt } = event;
    if (typeof id !== 'string' || !id || typeof fromRoleId !== 'string' ||
      typeof toRoleId !== 'string' || fromRoleId === toRoleId) return null;
    if (!Number.isFinite(createdAt) || createdAt <= 0 ||
      now - createdAt > 45000 || createdAt - now > 5000) return null;
    const from = room.roles.find(role => role.id === fromRoleId);
    const to = room.roles.find(role => role.id === toRoleId);
    return from && to ? { from, to, id } : null;
  }

  return { project, planHandoff, escapeHtml, stateLabel, specialty };
});
