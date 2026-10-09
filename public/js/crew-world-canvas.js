/* Crew World Canvas2D renderer. No external assets, WebGL or periodic network
 * requests. Characters exist independently of individual DOM card renders. */
(function (root, make) {
  'use strict';
  const api = make();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewWorldCanvas = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const W = 32;
  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function label(ctx, value, x, y, size, color, max) {
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let s = String(value ?? '');
    while (ctx.measureText(s).width > max && s.length > 1) s = s.slice(0, -2) + '…';
    ctx.fillText(s, x, y);
  }
  function panel(ctx, x, y, w, h, fill, stroke = '#9f805c') {
    rect(ctx, x + 3, y + 4, w, h, 'rgba(51,52,59,.17)');
    rect(ctx, x, y, w, h, stroke);
    rect(ctx, x + 3, y + 3, w - 6, h - 6, fill);
  }
  function drawPlant(ctx, x, y) {
    rect(ctx, x + 4, y + 19, 21, 19, '#995f42');
    rect(ctx, x + 7, y + 19, 15, 13, '#ce9464');
    rect(ctx, x + 13, y - 2, 5, 24, '#426d54');
    for (const [dx, dy, c] of [[2,8,'#3f9b76'],[14,1,'#439c73'],[18,9,'#3e8761'],[8,3,'#61bd8b']])
      rect(ctx, x + dx, y + dy, 12, 9, c);
  }
  function drawCup(ctx, x, y) {
    rect(ctx, x, y, 11, 9, '#f2f5e5');
    rect(ctx, x + 2, y + 2, 7, 4, '#9b6b49');
    rect(ctx, x + 11, y + 2, 3, 5, '#f2f5e5');
  }
  function room(ctx, map, state, language) {
    const en = language === 'en', t = (zh, english) => en ? english : zh;
    // Floor is a complete scrolling map, not a card background.
    rect(ctx, 0, 0, map.width, map.height, '#c9b894');
    for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
      const n = (x * 17 + y * 29) % 7;
      rect(ctx, x * W + 1, y * W + 1, 30, 30,
        n < 2 ? '#e9dab5' : n < 4 ? '#e3d1a9' : '#e5d5b1');
      if ((x + y * 3) % 11 === 0) rect(ctx, x * W + 27, y * W + 24, 2, 2, '#cebd9b');
    }
    // Top wall, windows, wall lights and reception door.
    rect(ctx, 0, 0, map.width, 72, '#87a7a0');
    rect(ctx, 0, 66, map.width, 11, '#785f55');
    rect(ctx, 0, 77, map.width, 5, '#b48d6b');
    for (const x of [75, 280, 485, 690]) {
      panel(ctx, x, 15, 80, 44, '#94dae4', '#b88b60');
      rect(ctx, x + 38, 17, 5, 38, '#d0efe6');
      rect(ctx, x + 5, 37, 70, 4, '#e7f7e7');
      rect(ctx, x + 12, 22, 21, 12, '#bbf1ef');
    }
    rect(ctx, 355, 51, 124, 29, '#4a7d78');
    label(ctx, 'CREW WORLD', 417, 65, 16, '#f5f6e3', 120);
    // Column pillars, plants and atmospheric wall lamps.
    for (const x of [18, 782]) {
      rect(ctx, x, 80, 22, map.height - 115, 'rgba(167,134,95,.11)');
    }
    drawPlant(ctx, 47, 101);
    drawPlant(ctx, 743, 104);
    drawPlant(ctx, 49, map.meetingY * W + 155);
    drawPlant(ctx, 745, map.meetingY * W + 154);
    // Board is functional: drawn in-map at the known hit box.
    const board = map.board;
    panel(ctx, board.x*W, board.y*W + 25, board.w*W, board.h*W, '#fff3cb', '#916342');
    rect(ctx, board.x*W + 10, board.y*W + 36, board.w*W-20, 6, '#cf725b');
    label(ctx, t('待辦公告', 'NOTICE BOARD'), board.x*W + 80, board.y*W + 59, 14, '#46586a', 135);
    const detail = !state.verified ? t('狀態尚未同步','NOT SYNCED') :
      state.attention ? t(state.attention + ' 則待處理',state.attention + ' pending') :
        t('目前無待辦', 'ALL CLEAR');
    label(ctx, detail, board.x*W + 80, board.y*W + 82, 12, '#845c43', 136);
    // Horizontal aisles and an actual shared corridor.
    for (let row = 0; row < Math.max(2, Math.ceil(map.seats.length/3)); row++) {
      const y = (5 + row*6 + 3) * W;
      rect(ctx, 78, y, map.width - 156, 12, 'rgba(255,250,223,.33)');
    }
    const cy = map.meetingY * W;
    rect(ctx, 65, cy - 25, map.width - 130, 12, 'rgba(255,250,223,.37)');
    // Coffee nook and bookshelves to make the floor lived-in.
    const lx = map.lounge.x*W, ly = map.lounge.y*W;
    panel(ctx, lx, ly, 130, 75, '#b69268', '#866448');
    panel(ctx, lx + 16, ly + 10, 49, 41, '#769b8f', '#557a72');
    rect(ctx, lx + 23, ly + 15, 34, 20, '#384c55');
    drawCup(ctx, lx + 81, ly + 17);
    label(ctx, t('休息角', 'BREAK'), lx + 64, ly + 98, 12, '#62503f', 128);
    for (let i=0; i<3; i++) {
      panel(ctx, 575+i*47, cy + 85, 42, 68, '#ab7857', '#725540');
      for (let j=0;j<5;j++) rect(ctx, 582+i*47+j*6, cy+98, 5,
        39 + (j%2)*9, ['#61a391','#d1af61','#6e85a2','#c27b75','#8e7bba'][j]);
    }
    // Meeting table is a real obstacle; agents approach its open side.
    const tx = map.table.x*W, ty = map.table.y*W;
    for (const x of [tx+20,tx+112]) {
      panel(ctx, x, ty-22, 28, 27, '#648a8c','#52757b');
      panel(ctx, x, ty+60, 28, 27, '#648a8c','#52757b');
    }
    panel(ctx, tx + 12, ty+8, 133, 60, '#be8a5a', '#78553e');
    rect(ctx, tx+40, ty+28, 72, 22, '#dcb084');
    label(ctx, t('協作桌', 'HANDOFFS'), tx+78, ty+41, 15, '#394e59', 95);
    // Bottom entry and trim.
    rect(ctx, 0, map.height-31, map.width, 31, '#987e65');
    rect(ctx, 0, map.height-31, map.width, 6, '#d6ac80');
    rect(ctx, 360, map.height-31, 112, 31, '#517b79');
    rect(ctx, 416, map.height-31, 5, 26, '#beddd5');
  }
  function desk(ctx, seat, state, language, time, reduced) {
    const en = language === 'en';
    const x = seat.x*W - 63, y = seat.y*W - 12;
    const working = state?.busy === true;
    panel(ctx, x+4, y+6, 124, 53, '#c39168', '#8c6046');
    rect(ctx, x+8, y+55, 12, 15, '#8f5f46');
    rect(ctx, x+116, y+55, 12, 15, '#8f5f46');
    panel(ctx, x+43, y-22, 47, 37, working ? '#285e61' : '#364d5b','#657e88');
    if (working) {
      rect(ctx, x+50, y-14, 30, 4, '#8de6bb');
      rect(ctx, x+50, y-5, 20 + (reduced ? 4 : Math.round((Math.sin(time*7)+1)*4)), 4, '#70c6c2');
    } else {
      rect(ctx, x+50, y-14, 22, 4, '#8fa8aa');
      rect(ctx, x+50, y-5, 13, 4, '#708b90');
    }
    rect(ctx, x+63, y+15, 7, 8, '#51656f');
    rect(ctx, x+49, y+24, 36, 6, '#d9cfbc');
    drawCup(ctx,x+100,y+25);
    panel(ctx, x+44, y+67, 48, 20, '#668f91','#4c6a6f');
    // Different functional props help locate a role, but never fake tool activity.
    if (state?.kind==='teacher') {
      rect(ctx,x+12,y+19,28,23,'#f5db9d'); rect(ctx,x+25,y+19,2,23,'#9b866c');
    } else if (state?.kind==='story') {
      rect(ctx,x+12,y+18,26,23,'#f4e7cd'); rect(ctx,x+16,y+25,17,2,'#b8a58a');
    } else if (state?.kind==='fortune') {
      rect(ctx,x+13,y+19,22,23,'#775c9c'); rect(ctx,x+18,y+24,11,11,'#e9cb95');
    } else {
      rect(ctx,x+12,y+22,28,14,'#456e87');rect(ctx,x+18,y+25,16,2,'#9ed4ba');
    }
    label(ctx, state?.name || seat.role.name, seat.x*W+1, y-32, 13, '#465063', 128);
    if (state?.selected) {
      ctx.strokeStyle='#299e85'; ctx.lineWidth=3; ctx.strokeRect(x-7,y-38,139,139);
    }
    if (state?.attention) {
      panel(ctx,x+111,y-41,25,23,'#fce3a5','#ad8b54');
      label(ctx,String(state.attention),x+123,y-29,12,'#855b28',21);
    }
  }
  function actor(ctx, a, time, reduced, language) {
    const x=a.pos.x, y=a.pos.y, seed=globalPalette(a.id);
    const p=seed.palette;
    const swinging = !reduced && a.walking ? Math.sin(a.step*3)*3 :
      (!reduced && a.work==='idle' ? Math.sin(time*1.5+seed.seed)*1.2 : 0);
    ctx.save(); ctx.translate(Math.round(x), Math.round(y + swinging));
    // Shadow persists separately from character movement.
    rect(ctx,-12,15,24,4,'rgba(48,51,52,.27)');
    const faceBack = a.facing === 'up' && a.walking;
    rect(ctx,-8,-1,16,17,p.coat);
    rect(ctx,-6,1,12,4,p.trim);
    rect(ctx,-7,14,6,8,'#424d65');
    rect(ctx,2,14,6,8,'#424d65');
    const arm = a.walking ? Math.sin(a.step*3)*3 : a.work==='working' ? Math.sin(time*9)*2 : 0;
    rect(ctx,-13,2+arm,5,12,p.coat);
    rect(ctx,8,2-arm,5,12,p.coat);
    rect(ctx,-13,12+arm,5,4,p.skin);
    rect(ctx,8,12-arm,5,4,p.skin);
    rect(ctx,-10,-19,20,19,p.skin);
    rect(ctx,-11,-21,22,6,p.hair);
    rect(ctx,-11,-17,4,10,p.hair);rect(ctx,8,-17,3,8,p.hair);
    if (!faceBack) {
      rect(ctx,-6,-9,3,3,'#333443');rect(ctx,4,-9,3,3,'#333443');
      rect(ctx,-2,-3,5,2,'#986860');
    } else rect(ctx,-8,-14,17,10,p.hair);
    if (a.work==='unknown') {
      ctx.fillStyle='rgba(180,186,188,.47)';ctx.fillRect(-14,-23,28,47);
    }
    if (a.work==='waiting') {
      panel(ctx,12,-38,21,21,'#f5c768','#b69042');
      label(ctx,'?',22,-27,14,'#685222',18);
    }
    if (a.work==='working') {
      panel(ctx,12,-38,22,20,'#d7f8e5','#64a994');
      label(ctx,'⌘',23,-28,11,'#2b7463',19);
    }
    // Only verified state and the current Runtime title may appear as a
    // bubble. Never fabricate filenames, tool calls or percent progress.
    if (a.work === 'working' || a.work === 'waiting') {
      const active = a.work === 'working';
      const message = active ? (a.role?.title ||
        (language === 'en' ? 'Working' : '工作中')) :
        (language === 'en' ? 'Needs attention' : '等待處理');
      panel(ctx,-61,-67,122,24,active ? '#d7f4e2' : '#fff0c4',
        active ? '#5c9986' : '#bc9354');
      label(ctx,message,0,-55,11,'#334c54',113);
      rect(ctx,-2,-43,5,5,active ? '#d7f4e2' : '#fff0c4');
    }
    ctx.restore();
  }
  function globalPalette(id) {
    const m=typeof window!=='undefined' ? window.CrewWorldModel : null;
    const pal=m?.PALETTES || [
      {skin:'#f0bf94',hair:'#413246',coat:'#6e75cb',trim:'#c5d7ff'},
      {skin:'#c58c69',hair:'#242c46',coat:'#368f86',trim:'#91e4c7'}
    ];
    let seed=2166136261;for(const c of String(id)){seed^=c.codePointAt(0);seed=Math.imul(seed,16777619);}
    return {seed:seed>>>0,palette:pal[(seed>>>0)%pal.length]};
  }
  function draw(ctx, world, camera, viewport, time, reduced, language) {
    const dpr=viewport.dpr||1;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,viewport.w,viewport.h);
    ctx.fillStyle='#253a45';ctx.fillRect(0,0,viewport.w,viewport.h);
    ctx.translate(viewport.w/2,viewport.h/2);
    ctx.scale(camera.scale,camera.scale);
    ctx.translate(-camera.x,-camera.y);
    room(ctx,world.map,world.room||{verified:false},language);
    // Furniture and characters share world coordinates; movement survives re-render.
    for(const seat of world.map.seats)
      desk(ctx,seat,world.actors.get(seat.roleId)?.role,language,time,reduced);
    const actors=[...world.actors.values()].sort((a,b)=>a.pos.y-b.pos.y);
    for(const a of actors) actor(ctx,a,time,reduced,language);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    // Mini world coordinates / current zoom are actual viewport values.
    rect(ctx,12,10,130,29,'rgba(30,48,58,.82)');
    label(ctx,'CREW WORLD  ·  ' + Math.round(camera.scale*100)+'%',77,25,11,'#edf7ef',122);
  }
  return { draw };
});
