/* Crew World engine: deterministic map, A* walking and persisted-message
 * choreography. No AI execution, conversation content or synthetic work. */
(function (root, make) {
  'use strict';
  const api = make();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewWorldModel = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const COLS = 26;
  const TILE = 32;
  const SEAT_X = [5, 13, 21];
  const MAX_EVENTS = 3;
  const PALETTES = [
    { skin: '#f0bf94', hair: '#413246', coat: '#6e75cb', trim: '#c5d7ff' },
    { skin: '#c58c69', hair: '#242c46', coat: '#368f86', trim: '#91e4c7' },
    { skin: '#e7b38c', hair: '#ad6250', coat: '#af6b9b', trim: '#f6c8ec' },
    { skin: '#b87856', hair: '#342335', coat: '#c58c48', trim: '#ffe3a6' },
    { skin: '#efcbab', hair: '#786249', coat: '#4c87a9', trim: '#b3e6ff' },
    { skin: '#d8a07a', hair: '#343638', coat: '#8c6ca3', trim: '#d8c6fa' }
  ];
  function hash(value) {
    let n = 2166136261;
    for (const char of String(value || 'role')) {
      n ^= char.codePointAt(0);
      n = Math.imul(n, 16777619);
    }
    return n >>> 0;
  }
  const at = (x, y) => ({ x, y });
  const cellKey = (p) => p.x + ',' + p.y;
  const pixel = (p) => at((p.x + .5) * TILE, (p.y + .5) * TILE);
  function buildMap(roles) {
    const sorted = [...(Array.isArray(roles) ? roles : [])]
      .filter(r => r && typeof r.id === 'string' && r.id.length)
      .sort((a, b) => a.id.localeCompare(b.id));
    const nRows = Math.max(2, Math.ceil(sorted.length / 3));
    const meetingY = 5 + nRows * 6 + 2;
    const rows = meetingY + 8;
    const blocked = new Set();
    const seats = sorted.map((role, index) => {
      const x = SEAT_X[index % 3], y = 5 + Math.floor(index / 3) * 6;
      for (let dx = -2; dx <= 2; dx++) blocked.add(cellKey(at(x + dx, y)));
      return { roleId: role.id, role, index, x, y, home: at(x, y + 2),
        reception: at(x, y + 3) };
    });
    // The real shared table is solid; agents walk to the open side.
    for (let x = 12; x <= 14; x++) blocked.add(cellKey(at(x, meetingY + 2)));
    const meeting = at(13, meetingY + 1);
    const board = { x: 2, y: 2, w: 5, h: 2 };
    const lounge = { x: 3, y: meetingY + 2, w: 5, h: 3 };
    const table = { x: 11, y: meetingY + 2, w: 5, h: 2 };
    return { width: COLS * TILE, height: rows * TILE, cols: COLS, rows,
      seats, blocked, meeting, meetingY, board, lounge, table };
  }
  function walkable(map, point) {
    return point.x > 0 && point.x < map.cols - 1 &&
      point.y > 0 && point.y < map.rows - 1 && !map.blocked.has(cellKey(point));
  }
  function findPath(map, from, to) {
    const start = at(Math.round(from.x), Math.round(from.y));
    const end = at(Math.round(to.x), Math.round(to.y));
    if (!walkable(map, start) || !walkable(map, end)) return [];
    if (cellKey(start) === cellKey(end)) return [start];
    // A* with Manhattan distance and bounded complexity for mobile WebView.
    const open = [{ p: start, g: 0, f: 0 }];
    const best = new Map([[cellKey(start), 0]]);
    const parent = new Map();
    let checked = 0;
    while (open.length && checked++ < map.cols * map.rows) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift();
      const key = cellKey(current.p);
      if (current.g !== best.get(key)) continue;
      if (key === cellKey(end)) {
        const path = [current.p];
        while (parent.has(cellKey(path[0]))) path.unshift(parent.get(cellKey(path[0])));
        return path;
      }
      for (const step of [at(1, 0), at(0, 1), at(-1, 0), at(0, -1)]) {
        const next = at(current.p.x + step.x, current.p.y + step.y);
        if (!walkable(map, next)) continue;
        const nk = cellKey(next), g = current.g + 1;
        if (g >= (best.get(nk) ?? Infinity)) continue;
        best.set(nk, g); parent.set(nk, current.p);
        open.push({ p: next, g, f: g + Math.abs(next.x - end.x) + Math.abs(next.y - end.y) });
      }
    }
    return [];
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  class World {
    constructor(officeModel) {
      this.officeModel = officeModel;
      this.room = null;
      this.map = buildMap([]);
      this.actors = new Map();
      this.activeEvents = new Set();
      this.pending = [];
      this.log = [];
      this.ambientClock = 0;
      this.ambientCursor = 0;
      this.reconcile({ verified: false, roles: [] });
    }
    reconcile(room) {
      const state = room || { verified: false, roles: [] };
      const newerMap = buildMap(state.roles);
      const prior = this.actors;
      const next = new Map();
      for (const seat of newerMap.seats) {
        const old = prior.get(seat.roleId);
        const sameHome = old && old.home.x === seat.home.x && old.home.y === seat.home.y;
        const actor = sameHome ? old : {
          id: seat.roleId, pos: pixel(seat.home), home: seat.home,
          facing: 'down', step: 0, mode: 'seated',
          queue: [], path: [], pause: 0, work: 'unknown', walking: false
        };
        actor.home = seat.home;
        actor.role = seat.role;
        actor.work = seat.role.state;
        // Idle wandering is only decorative. A real work or attention
        // transition immediately returns the character to its verified desk.
        if (actor.mode === 'ambient' && actor.work !== 'idle') {
          actor.queue = []; actor.path = []; actor.pause = 0;
          actor.walking = false; actor.mode = 'seated'; actor.pos = pixel(seat.home);
        }
        if (!state.verified || actor.work === 'unknown') {
          actor.queue = []; actor.path = []; actor.pause = 0;
          actor.walking = false; actor.mode = 'seated'; actor.pos = pixel(seat.home);
        }
        next.set(actor.id, actor);
      }
      this.actors = next; this.map = newerMap; this.room = state;
      if (!state.verified) { this.pending = []; this.ambientClock = 0; }
      return this;
    }
    acceptHandoff(event, now = Date.now()) {
      const proof = this.officeModel?.planHandoff(event, this.room, now);
      if (!proof || this.activeEvents.has(proof.id)) return false;
      this.activeEvents.add(proof.id);
      if (this.activeEvents.size > 100) this.activeEvents.delete(this.activeEvents.values().next().value);
      this.log.unshift({ id: proof.id, from: proof.from.name, to: proof.to.name, at: now });
      this.log.length = Math.min(this.log.length, 5);
      this.pending.push({ fromId: proof.from.id, toId: proof.to.id, id: proof.id });
      this.pending.length = Math.min(this.pending.length, MAX_EVENTS);
      // Real handoffs outrank visual idle routines, never the reverse.
      const sender = this.actors.get(proof.from.id);
      if (sender?.mode === 'ambient') {
        sender.queue = []; sender.path = []; sender.pause = 0;
        sender.walking = false; sender.mode = 'seated';
        sender.pos = pixel(sender.home);
      }
      return true;
    }
    startNext() {
      if (!this.pending.length || !this.room?.verified) return;
      const item = this.pending[0];
      const actor = this.actors.get(item.fromId);
      const receiver = this.map.seats.find(seat => seat.roleId === item.toId);
      if (!actor || !receiver) { this.pending.shift(); return; }
      if (actor.queue.length || actor.path.length || actor.pause > 0) return;
      this.pending.shift();
      actor.queue = [
        { go: this.map.meeting }, { pause: .42 },
        { go: receiver.reception }, { pause: .4 },
        { go: actor.home }
      ];
      actor.mode = 'handoff';
    }
    maybeStroll() {
      if (this.pending.length || !this.room?.verified) return;
      const idle = [...this.actors.values()].filter(actor =>
        actor.work === 'idle' && actor.mode === 'seated' &&
        !actor.queue.length && !actor.path.length && actor.pause === 0);
      if (!idle.length) return;
      const actor = idle[this.ambientCursor++ % idle.length];
      const stop = at(this.map.lounge.x + 5, this.map.lounge.y - 1);
      if (!findPath(this.map, actor.home, stop).length) return;
      actor.mode = 'ambient';
      actor.queue = [{ go: stop }, { pause: 1.3 }, { go: actor.home }];
    }
    tick(dt) {
      if (!this.room?.verified) return false;
      this.startNext();
      const seconds = Math.max(0, Math.min(Number(dt) || 0, .06));
      this.ambientClock += seconds;
      if (this.ambientClock >= 32) {
        this.ambientClock = 0;
        this.maybeStroll();
      }
      let changing = false;
      for (const actor of this.actors.values()) {
        if (actor.pause > 0) {
          actor.pause = Math.max(0, actor.pause - seconds); changing = true;
          continue;
        }
        if (!actor.path.length && actor.queue.length) {
          const task = actor.queue.shift();
          if (task.pause) { actor.pause = task.pause; changing = true; continue; }
          const start = at(Math.round(actor.pos.x / TILE - .5), Math.round(actor.pos.y / TILE - .5));
          const path = findPath(this.map, start, task.go);
          actor.path = path.length ? path.slice(1) : [];
          if (!path.length) { actor.queue = []; actor.mode = 'seated'; }
        }
        if (actor.path.length) {
          const target = pixel(actor.path[0]);
          const dx = target.x - actor.pos.x, dy = target.y - actor.pos.y;
          const distance = Math.hypot(dx, dy);
          const delta = Math.min(distance, seconds * TILE * 4.8);
          if (distance > .05) {
            actor.pos.x += dx / distance * delta; actor.pos.y += dy / distance * delta;
          }
          if (distance - delta <= .05) {
            actor.pos = target; actor.path.shift();
          }
          actor.facing = Math.abs(dx) >= Math.abs(dy)
            ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
          actor.step += seconds * 9;
          actor.walking = true; changing = true;
        } else {
          actor.walking = false;
          if (!actor.queue.length && actor.pause === 0) actor.mode = 'seated';
        }
      }
      return changing;
    }
  }
  return { TILE, COLS, PALETTES, hash, pixel, buildMap, findPath, walkable, World };
});
