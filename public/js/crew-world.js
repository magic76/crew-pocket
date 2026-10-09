/* Crew World UI: responsive viewport, touch camera and Runtime evidence bridge.
 * Does not replace active chat sessions or mutate the Role kernel. */
(function (root, make) {
  'use strict';
  const api = make();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewWorld = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const VIEW_KEY = 'crew_office_view_v1';
  const tr = (win, zh, en) => win.getCrewLocale?.() === 'en' ? en : zh;
  const validView = value => value === 'list' ? 'list' : 'office';

  function init(win, doc) {
    const engine = win?.CrewWorldModel, projector = win?.CrewOfficeModel;
    const painter = win?.CrewWorldCanvas;
    const shell = doc?.getElementById?.('crew-room-switchyard');
    const host = doc?.getElementById?.('crew-room-office');
    const switcher = doc?.getElementById?.('crew-room-view-switch');
    if (!engine || !projector || !painter || !shell || !host || !switcher) return null;
    const escape = projector.escapeHtml;
    host.innerHTML =
      '<section class="crew-world" aria-label="' + tr(win,'可探索的 AI 小隊辦公室','Explorable AI Crew Office') + '">' +
        '<div class="crew-world-topbar">' +
          '<span class="crew-world-title">CREW WORLD <small>LIVE</small></span>' +
          '<span id="crew-world-runtime" class="crew-world-runtime" role="status">' +
            tr(win,'連線確認中','Checking Runtime') + '</span>' +
        '</div>' +
        '<div class="crew-world-viewport" id="crew-world-viewport">' +
          '<canvas id="crew-world-canvas" tabindex="0" aria-label="' +
          tr(win,'辦公室地圖。方向鍵移動視角，加減鍵縮放，Enter 開啟目前角色',
            'Office map. Arrow keys pan; plus/minus zoom; Enter opens the active Role') +
          '"></canvas>' +
          '<div class="crew-world-tools" role="group" aria-label="' +
            tr(win,'地圖縮放','Map zoom') + '">' +
            '<button type="button" data-world-tool="in" aria-label="' +
              tr(win,'放大地圖','Zoom in') + '">＋</button>' +
            '<button type="button" data-world-tool="out" aria-label="' +
              tr(win,'縮小地圖','Zoom out') + '">−</button>' +
            '<button type="button" data-world-tool="reset" aria-label="' +
              tr(win,'回到辦公室入口','Reset camera') + '">⌂</button>' +
          '</div>' +
          '<span class="crew-world-hint">' +
            tr(win,'拖曳移動畫面 · 雙指縮放 · 點人物互動',
              'Drag to move · Pinch to zoom · Tap a character') +
          '</span>' +
        '</div>' +
        '<div id="crew-world-activity" class="crew-world-activity" role="status" aria-live="polite">' +
          tr(win,'等待真正的角色活動', 'Waiting for real Role activity') +
        '</div>' +
        '<div id="crew-world-quick" class="crew-world-quick" role="group" aria-label="' +
          tr(win,'快速切換角色','Quick access Roles') + '"></div>' +
      '</section>';
    const canvas = doc.getElementById('crew-world-canvas');
    const viewport = doc.getElementById('crew-world-viewport');
    const status = doc.getElementById('crew-world-runtime');
    const activity = doc.getElementById('crew-world-activity');
    const quick = doc.getElementById('crew-world-quick');
    const ctx = canvas?.getContext?.('2d', { alpha: false });
    if (!ctx) {
      host.innerHTML = ''; // Leave the P2 office available as a fallback.
      return null;
    }
    const world = new engine.World(projector);
    let view = 'office';
    try { view = validView(win.localStorage?.getItem(VIEW_KEY)); } catch (_) {}
    const camera = { x: world.map.width/2, y: 325, scale: 1 };
    const size = { w: 0, h: 0, dpr: 1 };
    const pointers = new Map();
    let startGesture = null, raf = 0, lastFrame = 0, lastPaint = 0, signature = '';
    let stamp = '', duration = 0;
    let cameraReady = false;
    const prefersReduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const active = () => view === 'office' && !doc.hidden && doc.body?.dataset?.primaryTab === 'crew';
    const btns = () => [...switcher.querySelectorAll('[data-crew-office-view]')];

    function bounds() {
      const halfX = size.w / (2 * camera.scale), halfY = size.h / (2 * camera.scale);
      const w = world.map.width, h = world.map.height;
      camera.x = halfX >= w/2 ? w/2 : clamp(camera.x, halfX, w-halfX);
      camera.y = halfY >= h/2 ? h/2 : clamp(camera.y, halfY, h-halfY);
    }
    const mapPoint = (sx, sy) => ({
      x: camera.x + (sx - size.w/2)/camera.scale,
      y: camera.y + (sy - size.h/2)/camera.scale
    });
    function resize() {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      size.w = box.width; size.h = box.height;
      size.dpr = Math.min(2, Math.max(1, win.devicePixelRatio || 1));
      const width = Math.round(size.w * size.dpr), height = Math.round(size.h * size.dpr);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (!cameraReady) {
        // Readable character sprites on mobile rather than tiny fit-to-room dots.
        camera.scale = size.w < 530 ? .95 : clamp(size.w / world.map.width, .95, 1.45);
        camera.x = world.map.width/2;
        camera.y = size.h / (2 * camera.scale) + 8;
        cameraReady = true;
      }
      bounds();
    }
    function zoomAt(nextScale, x = size.w/2, y = size.h/2) {
      const anchor = mapPoint(x, y);
      camera.scale = clamp(nextScale, .55, 2.25);
      camera.x = anchor.x - (x - size.w/2)/camera.scale;
      camera.y = anchor.y - (y - size.h/2)/camera.scale;
      bounds();
      request();
    }
    function refresh(force) {
      const snapshot = win.getCrewCockpitSnapshot?.();
      const projected = projector.project(snapshot);
      const newStamp = JSON.stringify(projected);
      if (newStamp === stamp && !force) return;
      stamp = newStamp;
      world.reconcile(projected);
      bounds();
      status.textContent = !projected.verified
        ? tr(win,'Runtime 尚未同步','Runtime not synced')
        : tr(win,projected.working+' 位工作中 · '+projected.attention+' 待處理',
          projected.working+' working · '+projected.attention+' pending');
      status.dataset.verified = String(projected.verified);
      const markup = projected.roles.map(r =>
        '<button type="button" class="crew-world-role" data-world-role="' +
        escape(r.id) + '" data-state="' + r.state + '" aria-label="' +
        escape(r.name+' · '+projector.stateLabel(r.state,win.getCrewLocale?.()==='en')) +
        '"><i aria-hidden="true"></i><strong>' + escape(r.name) + '</strong><small>' +
        escape(projector.stateLabel(r.state,win.getCrewLocale?.()==='en')) +
        '</small></button>').join('');
      if (markup !== signature) { signature = markup; quick.innerHTML = markup; }
      request();
    }
    function render(ts) {
      raf = 0;
      if (!active()) { lastFrame = 0; return; }
      resize();
      const elapsed = lastFrame ? clamp((ts-lastFrame)/1000,0,.06) : 0;
      lastFrame = ts;
      const changed = world.tick(elapsed);
      if (size.w && size.h && (changed || ts-lastPaint > (prefersReduced()?350:33))) {
        painter.draw(ctx,world,camera,size,ts/1000,prefersReduced(),win.getCrewLocale?.());
        lastPaint = ts;
      }
      // Keep a bounded timer only while the office is actually visible.
      // Returning to chats pauses RAF without affecting any active AI execution.
      raf = win.requestAnimationFrame(render);
    }
    function request() {
      if (!active() || raf) return;
      lastFrame = 0;
      raf = win.requestAnimationFrame(render);
    }
    function suspend() {
      if (raf) win.cancelAnimationFrame(raf);
      raf=0;lastFrame=0;
      pointers.clear();
      startGesture=null;
    }
    function setView(next, persist=true) {
      view = validView(next); shell.dataset.view = view;
      for (const b of btns()) {
        const chosen = b.dataset.crewOfficeView===view;
        b.classList.toggle('is-current',chosen);
        b.setAttribute('aria-pressed',String(chosen));
      }
      if (persist) try { win.localStorage?.setItem(VIEW_KEY,view); } catch (_) {}
      if (active()) { refresh(true);resize();request(); } else suspend();
    }
    function performTap(x,y) {
      const p = mapPoint(x,y);
      // Characters take priority over their work desks, as in a real game.
      let selected = null, best = Infinity;
      for (const a of world.actors.values()) {
        const d = Math.hypot(p.x-a.pos.x,p.y-a.pos.y);
        if (d<27 && d<best) { selected=a; best=d; }
      }
      if (selected) return win.openCrewCockpitRole?.(selected.id);
      for (const seat of world.map.seats) {
        if (Math.abs(p.x-seat.x*engine.TILE)<75 &&
          Math.abs(p.y-seat.y*engine.TILE)<58)
          return win.openCrewRoleDetail?.(seat.roleId);
      }
      const b = world.map.board;
      if (p.x>=b.x*32 && p.x<=(b.x+b.w)*32 &&
          p.y>=b.y*32+20 && p.y<=(b.y+b.h)*32+36) {
        return doc.getElementById('crew-attention-panel')?.scrollIntoView?.({
          block:'start',behavior:prefersReduced()?'auto':'smooth'
        });
      }
      const table = world.map.table;
      if (p.x>=table.x*32 && p.x<=(table.x+table.w)*32 &&
          p.y>=table.y*32 && p.y<=(table.y+table.h)*32+20) {
        const role=world.room?.roles.find(r=>r.selected)||world.room?.roles[0];
        if(role)win.openCrewCollaboration?.(role.id);
      }
    }
    const localPoint = (e) => {
      const b=canvas.getBoundingClientRect();
      return {x:e.clientX-b.left,y:e.clientY-b.top};
    };
    const ptrDist = (points) => Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
    function pointerDown(e) {
      if (!active())return;
      const p=localPoint(e);
      pointers.set(e.pointerId,p);
      canvas.setPointerCapture?.(e.pointerId);
      if (pointers.size===1) startGesture={tap:p,last:p,moved:false};
      else if (pointers.size===2) {
        const both=[...pointers.values()];
        startGesture={pinch:true,distance:ptrDist(both),scale:camera.scale,
          center:{x:(both[0].x+both[1].x)/2,y:(both[0].y+both[1].y)/2}};
      }
    }
    function pointerMove(e) {
      if (!pointers.has(e.pointerId))return;
      const p=localPoint(e);
      pointers.set(e.pointerId,p);
      if (pointers.size===2) {
        const ps=[...pointers.values()];
        if (!startGesture?.pinch) {
          startGesture={pinch:true,distance:ptrDist(ps),scale:camera.scale,
            center:{x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2}};
        }
        const center={x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2};
        const origin=mapPoint(center.x,center.y);
        camera.scale=clamp(startGesture.scale*(ptrDist(ps)/Math.max(1,startGesture.distance)),.55,2.25);
        camera.x=origin.x-(center.x-size.w/2)/camera.scale;
        camera.y=origin.y-(center.y-size.h/2)/camera.scale;
        bounds();request();return;
      }
      if (pointers.size===1 && startGesture && !startGesture.pinch) {
        const old=startGesture.last;
        if (Math.hypot(p.x-startGesture.tap.x,p.y-startGesture.tap.y)>8)
          startGesture.moved=true;
        if (startGesture.moved) {
          camera.x-=(p.x-old.x)/camera.scale;
          camera.y-=(p.y-old.y)/camera.scale;
          bounds();request();
        }
        startGesture.last=p;
      }
    }
    function pointerUp(e) {
      if(!pointers.has(e.pointerId))return;
      const p=localPoint(e),wasSingle=pointers.size===1;
      const tap=wasSingle && startGesture && !startGesture.pinch &&
        !startGesture.moved && Math.hypot(p.x-startGesture.tap.x,p.y-startGesture.tap.y)<9;
      pointers.delete(e.pointerId);
      try {canvas.releasePointerCapture?.(e.pointerId);}catch(_){}
      startGesture=null;
      if(tap)performTap(p.x,p.y);
    }
    canvas.addEventListener('pointerdown',pointerDown);
    canvas.addEventListener('pointermove',pointerMove);
    canvas.addEventListener('pointerup',pointerUp);
    canvas.addEventListener('pointercancel',pointerUp);
    canvas.addEventListener('wheel',e=>{
      if(!active())return;
      e.preventDefault();
      const p=localPoint(e);
      zoomAt(camera.scale*(e.deltaY>0?.88:1.12),p.x,p.y);
    },{passive:false});
    canvas.addEventListener('keydown',e=>{
      const step=48/camera.scale;
      if(e.key==='ArrowUp')camera.y-=step;
      else if(e.key==='ArrowDown')camera.y+=step;
      else if(e.key==='ArrowLeft')camera.x-=step;
      else if(e.key==='ArrowRight')camera.x+=step;
      else if(e.key==='+'||e.key==='=')zoomAt(camera.scale*1.2);
      else if(e.key==='-'||e.key==='_')zoomAt(camera.scale/1.2);
      else if(e.key==='Enter') {
        const role=world.room?.roles.find(r=>r.selected)||world.room?.roles[0];
        if(role)win.openCrewCockpitRole?.(role.id);
      } else return;
      e.preventDefault();bounds();request();
    });
    host.addEventListener('click',e=>{
      const tool=e.target.closest?.('[data-world-tool]');
      if(tool){
        const type=tool.dataset.worldTool;
        if(type==='in')zoomAt(camera.scale*1.2);
        if(type==='out')zoomAt(camera.scale/1.2);
        if(type==='reset'){
          cameraReady=false;resize();request();
        }
      }
      const role=e.target.closest?.('[data-world-role]');
      if(role)win.openCrewCockpitRole?.(role.dataset.worldRole);
    });
    switcher.addEventListener('click',e=>{
      const b=e.target.closest?.('[data-crew-office-view]');
      if(b)setView(b.dataset.crewOfficeView);
    });
    function onHandoff(e) {
      if(!active())return;
      refresh();
      if(world.acceptHandoff(e.detail)) {
        const last=world.log[0];
        activity.textContent=last.from+' → '+last.to+' · '+
          tr(win,'真實交接已記錄','Recorded handoff');
        request();
      }
    }
    win.addEventListener('crew:handoff-observed',onHandoff);
    win.addEventListener('crew:status-updated',()=>refresh());
    win.addEventListener('crew:roster-updated',()=>refresh());
    win.addEventListener('crew:role-selected',()=>refresh());
    doc.addEventListener('visibilitychange',()=>{
      if(doc.hidden)suspend();else if(active()){refresh(true);request();}
    });
    doc.addEventListener('crew:localechange',()=>refresh(true));
    if(win.ResizeObserver)new win.ResizeObserver(()=>{resize();request();}).observe(viewport);
    win.addEventListener('resize',()=>{resize();request();});
    if(win.MutationObserver)new win.MutationObserver(()=>{
      if(active()){refresh(true);resize();request();}else suspend();
    }).observe(doc.body,{attributes:true,attributeFilter:['data-primary-tab']});
    refresh(true);
    setView(view,false);
    return {setView,world,zoomAt,refresh,suspend,performTap};
  }
  return {init,validView};
});
