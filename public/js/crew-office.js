/* Crew Office P2/P3: presentation-only 2D floor and real-event movement.
 * The existing Role/Conversation/Memory kernels remain the source of truth. */
(function (root, make) {
  'use strict';
  const api = make();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewOffice = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const KEY = 'crew_office_view_v1';
  const validView = value => value === 'list' ? 'list' : 'office';
  const typeName = (type, en) => ({
    developer: en ? 'DEV STATION' : '開發工作桌',
    teacher: en ? 'STUDY DESK' : '教學工作桌',
    story: en ? 'STORY DESK' : '故事工作桌',
    fortune: en ? 'RESEARCH DESK' : '研究工作桌'
  })[type] || (en ? 'WORK DESK' : '工作桌');

  function seatMarkup(role, portrait, english, m) {
    const id = m.escapeHtml(role.id);
    const state = role.state;
    const status = m.stateLabel(state, english);
    const attention = role.attention > 0
      ? '<span class="crew-office-alert" aria-label="' + role.attention + (english ? ' attention items' : ' 則待處理') + '">' +
          role.attention + '</span>' : '';
    const activity = role.busy
      ? (role.title || (english ? 'Working now' : '正在工作'))
      : state === 'waiting'
        ? (english ? 'Requires attention' : '等待處理')
        : state === 'unknown'
          ? (english ? 'Waiting for Runtime' : '等待狀態同步')
          : (english ? 'Tap to open current chat' : '點擊進入目前對話');
    return '<div class="crew-office-seat" data-office-seat="' + id + '" data-state="' +
      state + '" data-selected="' + String(role.selected) + '">' +
      '<div class="crew-office-station-type">' + m.escapeHtml(typeName(role.kind, english)) + '</div>' +
      '<span class="crew-office-prop" data-kind="' + role.kind + '" aria-hidden="true"></span>' +
      '<div class="crew-office-desk" aria-hidden="true">' +
        '<span class="crew-office-display" data-state="' + state + '"></span>' +
        '<span class="crew-office-keyboard"></span>' +
        '<span class="crew-office-cup"></span>' +
      '</div>' +
      '<button type="button" class="crew-office-character" data-office-role="' + id +
        '" aria-label="' + m.escapeHtml(role.name + ' · ' + status + (english ? ' · Open current conversation' : ' · 開啟目前對話')) + '">' +
        '<span class="crew-office-actor" data-office-actor-id="' + id + '" data-state="' +
          state + '">' + portrait + '</span>' +
        '<span class="crew-office-character-label">' + m.escapeHtml(role.name) + '</span>' +
        '<span class="crew-office-character-state" data-state="' + state + '">' +
          m.escapeHtml(status) + '</span>' +
      '</button>' +
      attention +
      '<button type="button" class="crew-office-seat-more" data-office-details="' + id +
        '" aria-label="' + m.escapeHtml((english ? 'Manage ' : '管理 ') + role.name) + '">⋯</button>' +
      '<p class="crew-office-now">' + m.escapeHtml(activity) + '</p>' +
    '</div>';
  }

  function renderScene(room, win) {
    const m = win.CrewOfficeModel;
    const en = win.getCrewLocale?.() === 'en';
    const tr = (zh, english) => en ? english : zh;
    const boardText = !room.verified
      ? tr('連線尚未同步', 'Runtime not synced')
      : room.attention
        ? tr(room.attention + ' 則待處理', room.attention + ' need attention')
        : tr('目前無待處理事項', 'All clear');
    const workText = !room.verified
      ? tr('— 工作中', '— working')
      : tr(room.working + ' 位工作中', room.working + ' working');
    const boardInner = '<span class="crew-office-board-head">' +
        tr('公告板', 'NOTICE BOARD') + '</span>' +
        '<span class="crew-office-board-line">' + m.escapeHtml(boardText) + '</span>' +
        '<span class="crew-office-board-foot">' + m.escapeHtml(workText) + '</span>';
    const board = room.verified && room.attention > 0
      ? '<button type="button" class="crew-office-board" data-office-action="attention" ' +
          'aria-label="' + m.escapeHtml(tr('查看待處理事項', 'View attention items')) +
          '">' + boardInner + '</button>'
      : '<div class="crew-office-board" aria-label="' + m.escapeHtml(boardText) +
          '">' + boardInner + '</div>';

    const seats = room.roles.length
      ? room.roles.map(role => seatMarkup(role,
          win.CrewRoomVisual?.portraitMarkup({ id: role.id }) || '<span aria-hidden="true">●</span>',
          en, m)).join('')
      : '<div class="crew-office-empty">' +
          tr('還沒有小隊成員，點擊右上角 ＋ 新增 Role。',
             'No crew members yet. Use + to add a Role.') + '</div>';
    return '<div class="crew-office-building" aria-label="' +
        m.escapeHtml(tr('AI 小隊的 2D 辦公室', '2D AI Crew Office')) + '">' +
      '<div class="crew-office-wall" aria-hidden="true">' +
        '<span class="crew-office-window"></span>' +
        '<span class="crew-office-wall-clock"></span>' +
        '<span class="crew-office-window"></span>' +
      '</div>' +
      '<div class="crew-office-floor">' +
        '<div class="crew-office-lobby">' +
          '<div class="crew-office-plant" aria-hidden="true"><i></i><i></i></div>' +
          '<div class="crew-office-sign"><strong>CREW OFFICE</strong><small>' +
            tr('每個成員都有自己的工作桌', 'A desk for every Role') + '</small></div>' +
          board +
        '</div>' +
        '<div class="crew-office-desk-grid">' + seats + '</div>' +
        '<div class="crew-office-shared-zone">' +
          '<div class="crew-office-coffee" aria-hidden="true">' +
            '<span class="crew-office-coffee-top"></span>' +
            '<span class="crew-office-coffee-mug"></span>' +
            '<small>' + tr('休息角落', 'BREAK') + '</small>' +
          '</div>' +
          '<button type="button" class="crew-office-meeting" data-office-action="collaboration" ' +
            'aria-label="' + m.escapeHtml(tr('查看真實角色交接紀錄', 'Inspect stored Role handoffs')) + '">' +
            '<span class="crew-office-meeting-chairs" aria-hidden="true"></span>' +
            '<span class="crew-office-meeting-table">' +
              '<strong>' + tr('協作桌', 'HANDOFFS') + '</strong>' +
              '<small>' + tr('查看交接紀錄', 'Open activity log') + '</small>' +
            '</span>' +
          '</button>' +
          '<div class="crew-office-shelf" aria-hidden="true">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="crew-office-activity" role="status" aria-live="polite" aria-atomic="true">' +
        '<span class="crew-office-activity-icon" aria-hidden="true">✉</span>' +
        '<span id="crew-office-activity-line">' +
          tr('只有真實交接才會觸發角色移動', 'Movement follows real recorded handoffs') +
        '</span>' +
      '</div>' +
    '</div>';
  }

  function init(win, doc) {
    const model = win?.CrewOfficeModel;
    const shell = doc?.getElementById?.('crew-room-switchyard');
    const office = doc?.getElementById?.('crew-room-office');
    const buttons = doc?.getElementById?.('crew-room-view-switch');
    if (!model || !shell || !office || !buttons) return null;
    let view = 'office';
    try { view = validView(win.localStorage?.getItem(KEY)); } catch (_) {}
    let signature = '';
    let current = null;
    const isActive = () => !doc.hidden && doc.body?.dataset?.primaryTab === 'crew' && view === 'office';
    const reducedMotion = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    function render(force = false) {
      if (!isActive() && !force) return;
      const snapshot = win.getCrewCockpitSnapshot?.();
      current = model.project(snapshot);
      const next = JSON.stringify({
        verified: current.verified, roles: current.roles,
        attention: current.attention, working: current.working,
        locale: win.getCrewLocale?.() || 'zh-TW'
      });
      if (next === signature) return;
      signature = next;
      const focusedId = doc.activeElement?.dataset?.officeRole ||
        doc.activeElement?.dataset?.officeDetails;
      const focusKind = doc.activeElement?.dataset?.officeDetails ? 'officeDetails' : 'officeRole';
      office.innerHTML = renderScene(current, win);
      if (focusedId) {
        const targets = [...office.querySelectorAll('[data-office-role], [data-office-details]')];
        targets.find(node => node.dataset[focusKind] === focusedId)?.focus?.({ preventScroll: true });
      }
    }

    function setView(next, persist = true) {
      view = validView(next);
      shell.dataset.view = view;
      for (const button of buttons.querySelectorAll('[data-crew-office-view]')) {
        const selected = button.dataset.crewOfficeView === view;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('is-current', selected);
      }
      if (persist) {
        try { win.localStorage?.setItem(KEY, view); } catch (_) {}
      }
      if (view === 'office') render(true);
      // Keep UI tab selection separate from browser history / Role changes.
    }

    function actOnClick(event) {
      const action = event.target.closest?.('[data-office-action]');
      if (action) {
        if (action.dataset.officeAction === 'collaboration') {
          const selected = current?.roles.find(role => role.selected) || current?.roles[0];
          if (selected) win.openCrewCollaboration?.(selected.id);
        } else if (action.dataset.officeAction === 'attention') {
          doc.getElementById('crew-attention-panel')?.scrollIntoView?.({
            block: 'start', behavior: reducedMotion() ? 'instant' : 'smooth'
          });
        }
        return;
      }
      const details = event.target.closest?.('[data-office-details]');
      if (details) return win.openCrewRoleDetail?.(details.dataset.officeDetails);
      const role = event.target.closest?.('[data-office-role]');
      if (role) win.openCrewCockpitRole?.(role.dataset.officeRole);
    }

    function onHandoff(event) {
      if (!isActive()) return;
      // The feed's prior-ID baseline is maintained by CrewRoomVisual, not by
      // the Office renderer. No synthetic events or historical replay.
      const handoff = model.planHandoff(event?.detail, current);
      if (!handoff) return;
      const status = doc.getElementById('crew-office-activity-line');
      if (status) status.textContent = handoff.from.name + ' → ' + handoff.to.name +
        (win.getCrewLocale?.() === 'en' ? ' · handoff recorded' : ' · 已記錄交接');
      const stage = office.querySelector('.crew-office-building');
      const actor = [...office.querySelectorAll('[data-office-actor-id]')]
        .find(node => node.dataset.officeActorId === handoff.from.id);
      const receiver = [...office.querySelectorAll('[data-office-seat]')]
        .find(node => node.dataset.officeSeat === handoff.to.id);
      const table = office.querySelector('.crew-office-meeting');
      if (!actor || !receiver || !table || !stage || reducedMotion() || !actor.animate) return;

      // Move the sender to the shared handoff desk and back. This is a visual
      // metaphor for a saved message, NOT a claim that an actual meeting ran.
      const a = actor.getBoundingClientRect();
      const b = table.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      if (![dx, dy].every(Number.isFinite)) return;
      const motion = actor.animate([
        { transform: 'translate(0px,0px)', offset: 0 },
        { transform: 'translate(' + (dx * .48) + 'px,' + (dy * .48 - 16) + 'px)', offset: .32 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px)', offset: .54 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px)', offset: .65 },
        { transform: 'translate(0px,0px)', offset: 1 }
      ], { duration: 1350, easing: 'ease-in-out' });
      const station = actor.closest?.('.crew-office-seat');
      station?.classList.add('is-handoff-walker');
      actor.classList.add('is-walking');
      receiver.classList.add('has-handoff');
      const done = () => {
        actor.classList.remove('is-walking');
        station?.classList.remove('is-handoff-walker');
        receiver.classList.remove('has-handoff');
      };
      motion.addEventListener?.('finish', done, { once: true });
      motion.addEventListener?.('cancel', done, { once: true });
      win.setTimeout(done, 1600);
    }

    function onVerifiedStatus() {
      const before = current;
      render();
      if (!isActive() || !before?.verified || !current?.verified ||
          before === current || reducedMotion()) return;
      for (const oldRole of before.roles) {
        const nextRole = current.roles.find(role => role.id === oldRole.id);
        if (oldRole.state !== 'working' ||
            !['idle', 'waiting'].includes(nextRole?.state)) continue;
        const actor = [...office.querySelectorAll('[data-office-actor-id]')]
          .find(node => node.dataset.officeActorId === oldRole.id);
        if (!actor) continue;
        actor.classList.add('crew-office-settled');
        win.setTimeout(() => actor.classList.remove('crew-office-settled'), 1000);
      }
    }

    buttons.addEventListener('click', event => {
      const button = event.target.closest?.('[data-crew-office-view]');
      if (!button) return;
      setView(button.dataset.crewOfficeView);
    });
    office.addEventListener('click', actOnClick);
    win.addEventListener('crew:roster-updated', () => render());
    win.addEventListener('crew:status-updated', onVerifiedStatus);
    win.addEventListener('crew:role-selected', () => render());
    win.addEventListener('crew:handoff-observed', onHandoff);
    doc.addEventListener('visibilitychange', () => {
      if (!doc.hidden) render();
    });
    doc.addEventListener('crew:localechange', () => render(true));
    // Initial render occurs after app.js, which has already installed the
    // live Role snapshot API. Retain the original card list as the fallback.
    setView(view, false);
    return { setView, render, onHandoff };
  }
  return { init, renderScene, seatMarkup, validView };
});
