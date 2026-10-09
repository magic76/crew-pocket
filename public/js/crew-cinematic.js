/* Crew Cinematic: role identity, verified handoff signals, focus transitions.
 * Presentation only. Never fabricates progress or mutates provider/Role state. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewCinematic = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const TONES = Object.freeze(['pocket', 'teacher', 'story', 'fortune', 'helper', 'general']);
  const pattern = /[\w\u4e00-\u9fff-]+/g;
  function toneFor(role = {}) {
    const label = [role.project, role.name, role.projectId].filter(Boolean).join(' ').toLowerCase();
    if (/teacher|教學|老師/.test(label)) return 'teacher';
    if (/story|故事/.test(label)) return 'story';
    if (/fortune|命理|星盤|tarot/.test(label)) return 'fortune';
    if (/helper|助理/.test(label)) return 'helper';
    if (/pocket|crew-pocket/.test(label)) return 'pocket';
    if (/general|通用/.test(label)) return 'general';
    let hash = 2166136261;
    for (const char of String(role.id || label || 'agent')) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return TONES[(hash >>> 0) % TONES.length];
  }
  function point(rect) {
    return { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
  }
  function bezier(from, to, t) {
    const bend = Math.min(80, Math.max(16, Math.abs(to.x - from.x) * .18));
    const mid = { x: (from.x + to.x)/2, y: Math.min(from.y, to.y) - bend };
    const u = 1 - t;
    return {
      x: u*u*from.x + 2*u*t*mid.x + t*t*to.x,
      y: u*u*from.y + 2*u*t*mid.y + t*t*to.y
    };
  }
  function validHandoff(event, snapshot, now = Date.now()) {
    if (!snapshot?.verified || !event || typeof event.id !== 'string' ||
      !event.id || !Number.isFinite(event.createdAt) ||
      event.createdAt <= 0 || event.createdAt < now - 45000 ||
      event.createdAt > now + 5000 ||
      typeof event.fromRoleId !== 'string' || typeof event.toRoleId !== 'string' ||
      event.fromRoleId === event.toRoleId) return false;
    const ids = new Set((snapshot.roles || []).map(r => r.id));
    return ids.has(event.fromRoleId) && ids.has(event.toRoleId);
  }
  function init(win, doc) {
    const roster = doc?.getElementById?.('role-nav-list');
    const header = doc?.getElementById?.('workspace-selector-btn');
    if (!win || !doc || !roster || !header) return null;
    const seen = new Set();
    let alive = true, focusNode = null, link = null, linkRaf = 0;
    const reduced = () => win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    const visible = () => !doc.hidden && doc.body?.dataset?.primaryTab === 'crew';
    const cards = () => [...roster.querySelectorAll('[data-role-card-id]')];
    const activeSnapshot = () => win.getCrewCockpitSnapshot?.() || null;
    const allRoles = () => activeSnapshot()?.roles || [];
    const activeRole = () => {
      const snapshot = activeSnapshot();
      return snapshot?.roles?.find(r => r.id === snapshot.activeRoleId);
    };
    function decorate() {
      const roles = new Map(allRoles().map(role => [role.id, role]));
      for (const card of cards()) {
        const role = roles.get(card.dataset.roleCardId);
        if (!role) continue;
        card.dataset.crewTone = toneFor(role);
      }
      const role = activeRole();
      const tone = toneFor(role);
      doc.body.dataset.crewTone = tone;
      const verified = activeSnapshot()?.verified === true;
      const state = verified ? role?.status?.state : 'unknown';
      doc.body.dataset.crewRoleState = state === 'working' && role?.status?.busy !== true
        ? 'unknown' : (state || 'unknown');
      const statePill = doc.getElementById('crew-chat-role-state');
      if (statePill) {
        const stateText = { working:'工作中', waiting:'待處理', idle:'待命',
          new:'新工作', unknown:'狀態未同步' };
        statePill.textContent = stateText[doc.body.dataset.crewRoleState] || stateText.unknown;
        statePill.dataset.state = doc.body.dataset.crewRoleState;
      }
    }
    function stopLink() {
      if (linkRaf) win.cancelAnimationFrame?.(linkRaf);
      linkRaf = 0;
      link?.remove();
      link = null;
    }
    function safeCard(roleId) {
      return cards().find(card => card.dataset.roleCardId === roleId) || null;
    }
    function handoff(event) {
      if (!visible() || !validHandoff(event, activeSnapshot()) || seen.has(event.id)) return false;
      seen.add(event.id);
      if (seen.size > 70) seen.delete(seen.values().next().value);
      const from = safeCard(event.fromRoleId), to = safeCard(event.toRoleId);
      if (!from || !to) return false;
      from.classList.add('crew-handoff-source');
      to.classList.add('crew-handoff-target');
      win.setTimeout?.(() => {
        from.classList.remove('crew-handoff-source');
        to.classList.remove('crew-handoff-target');
      }, 1120);
      if (reduced()) return true;
      const a = point(from.getBoundingClientRect()), b = point(to.getBoundingClientRect());
      const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
      if (![a.x,a.y,b.x,b.y,vw,vh].every(Number.isFinite) ||
        a.y < 0 || b.y < 0 || a.y > vh || b.y > vh || vw <= 0) return true;
      stopLink();
      const ns = 'http://www.w3.org/2000/svg';
      const svg = doc.createElementNS(ns, 'svg');
      svg.setAttribute('class','crew-neural-link');
      svg.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
      svg.setAttribute('aria-hidden','true');
      const path = doc.createElementNS(ns,'path');
      const middle = bezier(a,b,.5);
      path.setAttribute('d', 'M '+a.x+' '+a.y+' Q '+middle.x+' '+(2*middle.y-(a.y+b.y)/2)+' '+b.x+' '+b.y);
      path.setAttribute('class','crew-neural-path');
      const dot = doc.createElementNS(ns,'circle');
      dot.setAttribute('r','5');
      dot.setAttribute('class','crew-neural-pulse');
      svg.appendChild(path);svg.appendChild(dot);
      doc.body.appendChild(svg);
      link = svg;
      let start = null;
      function frame(ts) {
        if (!alive || !visible() || !link || link !== svg) { stopLink(); return; }
        if (start === null) start = ts;
        const t = Math.min(1, Math.max(0,(ts - start)/930));
        const pos = bezier(a,b,t);
        dot.setAttribute('cx',String(pos.x));
        dot.setAttribute('cy',String(pos.y));
        svg.style.opacity = String(t > .83 ? (1 - t)/.17 : 1);
        if (t >= 1) {stopLink();return;}
        linkRaf = win.requestAnimationFrame(frame);
      }
      linkRaf = win.requestAnimationFrame(frame);
      return true;
    }
    function focus(event) {
      if (!visible() || reduced()) return;
      const target = event.target?.closest?.('[data-role-nav-id]');
      if (!target || !roster.contains(target)) return;
      const card = target.closest('[data-role-card-id]');
      const avatar = card?.querySelector('.crew-role-avatar');
      if (!avatar) return;
      const rect = avatar.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 12) return;
      focusNode?.remove();
      const clone = avatar.cloneNode(true);
      clone.classList.add('crew-focus-orb');
      clone.removeAttribute('id');
      clone.setAttribute('aria-hidden', 'true');
      clone.style.left = rect.left + 'px';
      clone.style.top = rect.top + 'px';
      clone.style.width = rect.width + 'px';
      clone.style.height = rect.height + 'px';
      doc.body.appendChild(clone);
      focusNode = clone;
      // Header is hidden in Crew view; use its DOM position after the
      // existing Role navigation swaps views, without delaying that action.
      const finish = () => {if (focusNode === clone) focusNode=null;clone.remove();};
      win.requestAnimationFrame(() => {
        if (!clone.isConnected || doc.hidden) {finish();return;}
        const destination = header.getBoundingClientRect();
        if (!destination.width) {finish();return;}
        const dx = destination.left + destination.width/2 - (rect.left+rect.width/2);
        const dy = destination.top + destination.height/2 - (rect.top+rect.height/2);
        if (!clone.animate) {finish();return;}
        const anim = clone.animate([
          { transform:'translate3d(0,0,0) scale(1)', opacity:1 },
          { transform:'translate3d('+dx+'px,'+dy+'px,0) scale(.72)', opacity:.24 }
        ], {duration:440,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
        anim.addEventListener('finish',finish,{once:true});
        anim.addEventListener('cancel',finish,{once:true});
        win.setTimeout(finish,550);
      });
    }
    function onTabChange() {
      if (!visible()) {stopLink();focusNode?.remove();focusNode=null;}
      else decorate();
    }
    roster.addEventListener('click',focus,true); // identity only; existing navigation remains unchanged
    win.addEventListener('crew:roster-updated',decorate);
    win.addEventListener('crew:status-updated',decorate);
    win.addEventListener('crew:role-selected',decorate);
    win.addEventListener('crew:handoff-observed',ev=>handoff(ev.detail));
    win.addEventListener('crew:streaming-state',event=>{
      const snapshot=activeSnapshot();
      const current = snapshot?.activeRoleId;
      const matches = Boolean(event?.detail?.roleId && event.detail.roleId === current);
      doc.body.classList.toggle('crew-role-streaming', matches && event.detail.streaming === true);
    });
    doc.addEventListener('visibilitychange',()=>{if(doc.hidden)stopLink();else decorate();});
    if (win.MutationObserver) new win.MutationObserver(onTabChange).observe(doc.body,{
      attributes:true,attributeFilter:['data-primary-tab']
    });
    decorate();
    return {decorate,handoff,stopLink,focus,close(){alive=false;stopLink();focusNode?.remove();}};
  }
  return {TONES,toneFor,bezier,validHandoff,init};
});
