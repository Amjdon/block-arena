// Maze Race mode: colored squares race through a maze to the checkered finish.
// movement 'auto'   -> squares bounce around on their own
// movement 'ai'     -> squares find their own way to the finish (each with a slightly different "skill")
// movement 'player' -> each player steers their own square; others come from the network (or are AI bots in solo)
// 'auto' and 'ai' are deterministic from the seed, so every client sees exactly the same race.
import { play } from './sound.js';
import { mulberry32 } from './game.js';

export const MC = 16;          // pixels per maze cell
const HALF = 5;                // half size of a racer square
const FPS = 60;
const COUNTDOWN = 150;         // frames before the race starts
const PUSH_HOLD = 40;          // frames a pusher waits at each end
const AI_SPEED = 0.7;          // smart squares move a bit slower so races are watchable

export const T = {
  FLOOR: 0, WALL: 1, BREAK: 2, FINISH: 3, GATE: 4, BOOST: 5, SLOW: 6, ITEM: 7,
  PUSH_R: 8, PUSH_L: 9, PUSH_D: 10, PUSH_U: 11,
  I_SPEED: 12, I_GHOST: 13, I_BOMB: 14, I_FREEZE: 15,
};
export const MAX_TILE = 15;
export const TILE_INFO = [
  { name: 'أرضية', icon: '⬜' },
  { name: 'جدار', icon: '🧱' },
  { name: 'بلوك ينكسر', icon: '⬛' },
  { name: 'خط النهاية', icon: '🏁' },
  { name: 'بوابة (تفتح بعد وقت)', icon: '🚪' },
  { name: 'تسريع', icon: '⚡' },
  { name: 'طين (تبطيء)', icon: '🟫' },
  { name: 'أيتم عشوائي', icon: '🎁' },
  { name: 'جدار يدف →', icon: '➡' },
  { name: 'جدار يدف ←', icon: '⬅' },
  { name: 'جدار يدف ↓', icon: '⬇' },
  { name: 'جدار يدف ↑', icon: '⬆' },
  { name: 'أداة: سرعة', icon: '💨' },
  { name: 'أداة: اختراق', icon: '👻' },
  { name: 'أداة: قنبلة', icon: '💣' },
  { name: 'أداة: تجميد الباقين', icon: '❄' },
];
const PUSH_DIR = { [T.PUSH_R]: [1, 0], [T.PUSH_L]: [-1, 0], [T.PUSH_D]: [0, 1], [T.PUSH_U]: [0, -1] };
const PUSH_ARROW = { [T.PUSH_R]: '►', [T.PUSH_L]: '◄', [T.PUSH_D]: '▼', [T.PUSH_U]: '▲' };
const TOOL = { [T.I_SPEED]: 'speed', [T.I_GHOST]: 'ghost', [T.I_BOMB]: 'bomb', [T.I_FREEZE]: 'freeze' };
const TOOL_ICON = { speed: '»', ghost: '◌', bomb: '✹', freeze: '❄' };
const TOOL_COLOR = { speed: '#ffb300', ghost: '#7fd3ff', bomb: '#ff5a3d', freeze: '#6ec6ff' };
const isItem = v => v === T.ITEM || (v >= T.I_SPEED && v <= T.I_FREEZE);
const isPusher = v => v >= T.PUSH_R && v <= T.PUSH_U;

export const RACER_COLORS = ['#e53935', '#1e6fff', '#11865a', '#f5c518', '#9c27b0', '#ff7a00', '#00bcd4', '#ec407a'];
export const RACER_NAMES = ['الأحمر', 'الأزرق', 'الأخضر', 'الأصفر', 'البنفسجي', 'البرتقالي', 'السماوي', 'الوردي'];

const COL = { floor: '#e3e3dd', wall: '#a7a7a7', edge: '#4a4a4a', brk: '#2c3142', gate: '#3f36a0', boost: '#ffd34d', slow: '#8a6a45', item: '#9d7bff', push: '#c0392b' };

function drawPusherBlock(ctx, x, y, s, v) {
  // yellow/black hazard border, red core
  ctx.fillStyle = '#f1c40f'; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = '#222';
  for (let k = 0; k < s; k += 4) { ctx.fillRect(x + k, y, 2, 2); ctx.fillRect(x + k, y + s - 2, 2, 2); ctx.fillRect(x, y + k, 2, 2); ctx.fillRect(x + s - 2, y + k, 2, 2); }
  ctx.fillStyle = COL.push; ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
  ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(s * 0.6)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(PUSH_ARROW[v], x + s / 2, y + s / 2 + 1);
  ctx.strokeStyle = '#5a1a12'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
}

// Draws one static tile. `open` = gates are open, `itemOn` = item box present, `dynamic` = pushers drawn elsewhere.
export function drawMazeTile(ctx, v, c, r, s, open = false, itemOn = true, hpFrac = 1, dynamic = false) {
  const x = c * s, y = r * s;
  ctx.fillStyle = v === T.WALL ? COL.wall : COL.floor;
  ctx.fillRect(x, y, s, s);
  if (isPusher(v)) { if (!dynamic) drawPusherBlock(ctx, x, y, s, v); return; }
  if (isItem(v)) {
    if (!itemOn) return;
    const tool = TOOL[v];
    ctx.fillStyle = tool ? TOOL_COLOR[tool] : COL.item; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 3.5, y + 3.5, s - 7, s - 7);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(s * 0.55)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tool ? TOOL_ICON[tool] : '?', x + s / 2, y + s / 2 + 1);
    return;
  }
  switch (v) {
    case T.BREAK:
      ctx.fillStyle = COL.brk; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
      if (hpFrac < 1) { ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 2, y + s * 0.3); ctx.lineTo(x + s * 0.5, y + s * 0.55); ctx.lineTo(x + s - 2, y + s * (0.9 - hpFrac * 0.5)); ctx.stroke(); }
      break;
    case T.FINISH: {
      const q = s / 4;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(x + i * q, y + j * q, q, q); }
      break;
    }
    case T.GATE:
      if (!open) { ctx.fillStyle = COL.gate; ctx.fillRect(x, y, s, s); }
      else { ctx.strokeStyle = 'rgba(63,54,160,.35)'; ctx.setLineDash([2, 2]); ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1); ctx.setLineDash([]); }
      break;
    case T.BOOST:
      ctx.fillStyle = COL.boost; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = '#b8860b'; ctx.font = `bold ${Math.round(s * 0.7)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('»', x + s / 2, y + s / 2 + 1);
      break;
    case T.SLOW:
      ctx.fillStyle = COL.slow; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + s * 0.2, y + s * 0.3, 2, 2); ctx.fillRect(x + s * 0.6, y + s * 0.6, 2, 2);
      break;
  }
}

// Dark outline where walls meet open space (gives the clean "drawn maze" look).
function drawEdges(ctx, cells, cols, rows, s) {
  ctx.fillStyle = COL.edge;
  const wall = (c, r) => c < 0 || r < 0 || c >= cols || r >= rows || cells[r * cols + c] === T.WALL;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (wall(c, r)) continue;
    const x = c * s, y = r * s;
    if (wall(c, r - 1)) ctx.fillRect(x, y, s, 1);
    if (wall(c, r + 1)) ctx.fillRect(x, y + s - 1, s, 1);
    if (wall(c - 1, r)) ctx.fillRect(x, y, 1, s);
    if (wall(c + 1, r)) ctx.fillRect(x + s - 1, y, 1, s);
  }
}

export function drawMazePreview(canvas, map, s = 8) {
  canvas.width = map.cols * s; canvas.height = map.rows * s;
  const ctx = canvas.getContext('2d');
  for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) drawMazeTile(ctx, map.cells[r * map.cols + c], c, r, s);
  drawEdges(ctx, map.cells, map.cols, map.rows, s);
  (map.starts || []).forEach((i, k) => {
    ctx.fillStyle = RACER_COLORS[k % 8];
    const c = i % map.cols, r = Math.floor(i / map.cols);
    ctx.fillRect(c * s + s * 0.2, r * s + s * 0.2, s * 0.6, s * 0.6);
  });
}

// Tiny binary heap for the path-finding distance field.
class Heap {
  constructor() { this.a = []; }
  push(d, i) {
    const a = this.a; a.push([d, i]);
    let k = a.length - 1;
    while (k) { const p = (k - 1) >> 1; if (a[p][0] <= a[k][0]) break; [a[p], a[k]] = [a[k], a[p]]; k = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]]; k = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export class MazeGame {
  // racers: [{ color, name, kind: 'auto' | 'ai' | 'local' | 'remote', id }]
  constructor(canvas, map, opts = {}) {
    this.kind = 'maze';
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.map = map; this.opts = opts;
    this.cols = map.cols; this.rows = map.rows;
    this.W = map.cols * MC; this.H = map.rows * MC;
    canvas.width = this.W; canvas.height = this.H;
    this.cells = Int8Array.from(map.cells);
    this.rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 1e9));
    this.movement = opts.movement || map.movement || 'auto';
    this.stopOnWin = opts.stopOnWin ?? !!map.stopOnWin;
    this.baseSpeed = map.speed || 2.4;
    this.gateFrame = Math.round((map.gateTime ?? 2) * FPS);
    this.breakHp = map.breakHp || 3;
    this.timeLimit = Math.round((map.timeLimit || 180) * FPS);
    this.hp = new Map();
    this.itemBack = new Map();   // cell index -> frame when the item box comes back
    this.frame = 0; this.t = 0; this.over = false; this.placeN = 0;
    this.keys = {}; this.pointer = null;
    this.layer = document.createElement('canvas');
    this.layer.width = this.W; this.layer.height = this.H; this.dirty = true;
    this.particles = [];
    this.buildPushers();
    this.fieldDirty = true;

    const starts = map.starts?.length ? map.starts : [this.cols + 1];
    this.racers = (opts.racers || []).map((rc, k) => {
      const si = starts[k % starts.length];
      const r = {
        ...rc, k, x: (si % this.cols) * MC + MC / 2, y: Math.floor(si / this.cols) * MC + MC / 2,
        vx: 0, vy: 0, done: false, dead: false, place: 0, time: 0,
        boostUntil: 0, ghostUntil: 0, frozenUntil: 0, tx: null, ty: null,
        skill: 0, detourUntil: 0, detour: null, stuck: 0, lastX: 0, lastY: 0,
      };
      if (r.kind === 'auto' || r.kind === 'ai') {
        // random direction without trig (sqrt is exact, so every browser gets the same race)
        let dx = this.rng() * 2 - 1, dy = this.rng() * 2 - 1;
        if (Math.abs(dx) < 0.25) dx = dx < 0 ? -0.25 : 0.25;
        if (Math.abs(dy) < 0.25) dy = dy < 0 ? -0.25 : 0.25;
        const l = Math.sqrt(dx * dx + dy * dy); r.vx = dx / l; r.vy = dy / l;
        r.skill = 0.55 + this.rng() * 0.4; // how well an AI square follows the best path
      }
      return r;
    });
    this.local = this.racers.find(r => r.kind === 'local') || null;
    this.bindInput();
    this.last = performance.now(); this.acc = 0;
    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  // ---------- pushers (moving walls) ----------
  buildPushers() {
    this.pushers = [];
    this.track = new Map();
    const range = Math.max(1, Math.min(12, this.map.pushRange || 3));
    this.pushSpeed = Math.max(0.3, Math.min(4, this.map.pushSpeed || 1));
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      if (!isPusher(v)) continue;
      const [dx, dy] = PUSH_DIR[v];
      const c = i % this.cols, r = Math.floor(i / this.cols);
      let travel = 0;
      for (let k = 1; k <= range; k++) {
        const nc = c + dx * k, nr = r + dy * k;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) break;
        const w = this.cells[nr * this.cols + nc];
        if (w === T.WALL || w === T.BREAK || w === T.GATE) break;
        travel = k;
      }
      const ox = c * MC, oy = r * MC;
      const p = { v, dx, dy, travel, ox, oy, x: ox, y: oy };
      this.pushers.push(p);
      this.cells[i] = T.FLOOR;
      // cells this pusher sweeps through, including its home cell (AI avoids them while it's active)
      for (let k = 0; k <= travel; k++) {
        const j = (r + dy * k) * this.cols + (c + dx * k);
        if (!this.track.has(j)) this.track.set(j, []);
        this.track.get(j).push(p);
      }
    }
  }
  // is this pusher out, or about to come out within ~0.4s?
  // can a square cross this pusher's path (taking `cross` frames) before the pusher comes out?
  pusherDanger(p, cross = 20) {
    const now = this.pusherOffset(this.t), soon = this.pusherOffset(this.t + cross);
    return now(p) > 0 || soon(p) > 0;
  }
  pusherOffset(t) {
    // 0 -> travel -> 0 with a pause at both ends; pure integer-ish math, same on every client
    return p => {
      const dist = p.travel * MC;
      if (!dist) return 0;
      const move = Math.ceil(dist / this.pushSpeed), cycle = 2 * move + 2 * PUSH_HOLD;
      const f = t % cycle;
      if (f < PUSH_HOLD) return 0;
      if (f < PUSH_HOLD + move) return Math.min(dist, (f - PUSH_HOLD) * this.pushSpeed);
      if (f < 2 * PUSH_HOLD + move) return dist;
      return Math.max(0, dist - (f - 2 * PUSH_HOLD - move) * this.pushSpeed);
    };
  }
  movePushers() {
    if (!this.pushers.length) return;
    const off = this.pusherOffset(this.t);
    for (const p of this.pushers) {
      const o = off(p);
      const nx = p.ox + p.dx * o, ny = p.oy + p.dy * o;
      const mx = nx - p.x, my = ny - p.y;
      p.x = nx; p.y = ny;
      if (!mx && !my) continue;
      // push racers out of the way along the motion; squished if they can't move
      for (const r of this.racers) {
        if (r.done || r.kind === 'remote') continue;
        if (!this.overlapBox(r.x, r.y, p.x, p.y)) continue;
        let tx = r.x, ty = r.y;
        if (mx > 0) tx = p.x + MC + HALF; else if (mx < 0) tx = p.x - HALF;
        if (my > 0) ty = p.y + MC + HALF; else if (my < 0) ty = p.y - HALF;
        if (this.hits(tx, ty, this.t < r.ghostUntil, p).length) this.kill(r);
        else { r.x = tx; r.y = ty; }
      }
    }
  }
  overlapBox(x, y, px, py) {
    return x + HALF > px && x - HALF < px + MC && y + HALF > py && y - HALF < py + MC;
  }
  kill(r) {
    if (r.done) return;
    r.done = true; r.dead = true; r.place = 0; r.time = this.t;
    play('lose_life');
    this.opts.onToast?.(`💀 ${r.name} انعصر!`);
    for (let k = 0; k < 10; k++) this.particles.push({ x: r.x, y: r.y, vx: (this.rng() - 0.5) * 4, vy: (this.rng() - 0.5) * 4, life: 30, col: r.color });
  }

  // ---------- input ----------
  bindInput() {
    this.onKey = e => {
      const down = e.type === 'keydown';
      const k = e.key.toLowerCase();
      if (['arrowleft', 'a'].includes(k)) this.keys.l = down;
      if (['arrowright', 'd'].includes(k)) this.keys.r = down;
      if (['arrowup', 'w'].includes(k)) this.keys.u = down;
      if (['arrowdown', 's'].includes(k)) this.keys.d = down;
      if (this.local && k.startsWith('arrow')) e.preventDefault();
    };
    const pos = e => { const b = this.cv.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * this.W, y: ((e.clientY - b.top) / b.height) * this.H }; };
    this.onDown = e => { this.pointer = pos(e); this.cv.setPointerCapture?.(e.pointerId); };
    this.onMove = e => { if (this.pointer) this.pointer = pos(e); };
    this.onUp = () => { this.pointer = null; };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.cv.addEventListener('pointerdown', this.onDown);
    this.cv.addEventListener('pointermove', this.onMove);
    this.cv.addEventListener('pointerup', this.onUp);
    this.cv.addEventListener('pointercancel', this.onUp);
  }

  destroyGame() {
    cancelAnimationFrame(this.raf); this.over = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.cv.removeEventListener('pointerdown', this.onDown);
    this.cv.removeEventListener('pointermove', this.onMove);
    this.cv.removeEventListener('pointerup', this.onUp);
    this.cv.removeEventListener('pointercancel', this.onUp);
  }

  // ---------- world ----------
  gatesOpen() { return this.t >= this.gateFrame; }
  tileAt(px, py) {
    const c = Math.floor(px / MC), r = Math.floor(py / MC);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return { v: T.WALL, i: -1 };
    const i = r * this.cols + c;
    return { v: this.cells[i], i };
  }
  solid(v, ghost) {
    return v === T.WALL || (v === T.BREAK && !ghost) || (v === T.GATE && !this.gatesOpen());
  }
  // solid things a racer box at (x,y) would overlap: cell indices, -1 = edge, -2 = pusher
  hits(x, y, ghost, ignorePusher = null) {
    const out = [];
    const c0 = Math.floor((x - HALF) / MC), c1 = Math.floor((x + HALF - 0.001) / MC);
    const r0 = Math.floor((y - HALF) / MC), r1 = Math.floor((y + HALF - 0.001) / MC);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) { out.push(-1); continue; }
      const i = r * this.cols + c;
      if (this.solid(this.cells[i], ghost)) out.push(i);
    }
    for (const p of this.pushers) if (p !== ignorePusher && this.overlapBox(x, y, p.x, p.y)) out.push(-2);
    return out;
  }
  damage(i) {
    if (i < 0 || this.cells[i] !== T.BREAK) return;
    const hp = (this.hp.get(i) ?? this.breakHp) - 1;
    if (hp <= 0) { this.breakCell(i); this.opts.onBreak?.(i); play('brick', 6); }
    else { this.hp.set(i, hp); this.dirty = true; this.fieldDirty = true; play('wall'); }
  }
  breakCell(i) {
    if (this.cells[i] !== T.BREAK) return;
    this.cells[i] = T.FLOOR; this.hp.delete(i); this.dirty = true; this.fieldDirty = true;
  }
  // try to move; returns true if blocked
  tryMove(r, dx, dy) {
    const nx = r.x + dx, ny = r.y + dy;
    const h = this.hits(nx, ny, this.t < r.ghostUntil);
    if (!h.length) { r.x = nx; r.y = ny; return false; }
    for (const i of h) this.damage(i);
    return true;
  }
  speedOf(r) {
    let s = this.baseSpeed * (r.kind === 'ai' ? AI_SPEED : 1);
    if (this.t < r.boostUntil) s *= 1.7;
    if (this.tileAt(r.x, r.y).v === T.SLOW) s *= 0.45;
    return s;
  }
  nudge(r) {
    // small deterministic wobble on each bounce so squares never loop forever
    r.vx += (this.rng() - 0.5) * 0.3; r.vy += (this.rng() - 0.5) * 0.3;
    if (Math.abs(r.vx) < 0.2) r.vx = r.vx < 0 ? -0.2 : 0.2;
    if (Math.abs(r.vy) < 0.2) r.vy = r.vy < 0 ? -0.2 : 0.2;
    const l = Math.sqrt(r.vx * r.vx + r.vy * r.vy); r.vx /= l; r.vy /= l;
  }

  // ---------- AI: distance field from the finish ----------
  stepCost(v, i) {
    if (v === T.WALL) return Infinity;
    if (v === T.BREAK) return 2 + (this.hp.get(i) ?? this.breakHp) * 3;
    if (v === T.SLOW) return 3;
    if (v === T.BOOST) return 0.6;
    if (v === T.GATE) return this.gatesOpen() ? 1 : 2;
    return 1;
  }
  buildField() {
    const n = this.cells.length, dist = new Float64Array(n).fill(Infinity), h = new Heap();
    for (let i = 0; i < n; i++) if (this.cells[i] === T.FINISH) { dist[i] = 0; h.push(0, i); }
    while (h.size) {
      const [d, i] = h.pop();
      if (d > dist[i]) continue;
      const c = i % this.cols, r = (i / this.cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const j = nr * this.cols + nc, cost = this.stepCost(this.cells[j], j);
        if (d + cost < dist[j]) { dist[j] = d + cost; h.push(d + cost, j); }
      }
    }
    this.field = dist; this.fieldDirty = false;
  }
  // AI steering: head for the neighbouring cell closest to the finish, with personal mistakes
  steer(r) {
    r.hold = false;
    if (this.fieldDirty) this.buildField();
    const c = Math.floor(r.x / MC), row = Math.floor(r.y / MC);
    const here = this.field[row * this.cols + c];
    let target = null;
    if (this.t < r.detourUntil && r.detour) target = r.detour;
    else if (Number.isFinite(here)) {
      let best = here, bc = c, br = row;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const d = this.field[nr * this.cols + nc];
        if (d < best) { best = d; bc = nc; br = nr; }
      }
      target = [bc * MC + MC / 2, br * MC + MC / 2];
      // careful squares wait before stepping under an active pusher (brave ones risk it)
      const nextTrack = this.track.get(br * this.cols + bc);
      r.hold = r.skill > 0.62 && !this.track.has(row * this.cols + c) && !!nextTrack && nextTrack.some(p => this.pusherDanger(p, Math.ceil((MC + 2 * HALF) / this.speedOf(r)) + 8));
      if (r.hold) {
        // wait in the middle of the current cell so no part of the square sticks into the pusher's path
        const cx = c * MC + MC / 2 - r.x, cy = row * MC + MC / 2 - r.y, d = Math.sqrt(cx * cx + cy * cy);
        r.holdDist = d;
        if (d > 0.01) { r.vx = cx / d; r.vy = cy / d; }
        return;
      }
      // occasionally wander off for a moment (less skilled squares more often)
      if (this.rng() < (1 - r.skill) * 0.012) {
        const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => {
          const nc = c + dc, nr = row + dr;
          return nc >= 0 && nr >= 0 && nc < this.cols && nr < this.rows && this.cells[nr * this.cols + nc] !== T.WALL;
        });
        if (opts.length) {
          const [dc, dr] = opts[Math.floor(this.rng() * opts.length)];
          r.detour = [(c + dc) * MC + MC / 2, (row + dr) * MC + MC / 2]; r.detourUntil = this.t + 20 + Math.floor(this.rng() * 30);
        }
      }
    }
    if (!target) return;
    let dx = target[0] - r.x, dy = target[1] - r.y;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 0.5) return;
    dx /= l; dy /= l;
    const k = 0.12 + r.skill * 0.25;
    r.vx += (dx - r.vx) * k; r.vy += (dy - r.vy) * k;
    // stuck detection: if barely moving for a while, take a random detour
    const moved = Math.abs(r.x - r.lastX) + Math.abs(r.y - r.lastY);
    r.lastX = r.x; r.lastY = r.y;
    r.stuck = moved < 0.3 ? r.stuck + 1 : 0;
    if (r.stuck > 40) { r.stuck = 0; r.vx = this.rng() * 2 - 1; r.vy = this.rng() * 2 - 1; r.detourUntil = 0; }
    const m = Math.sqrt(r.vx * r.vx + r.vy * r.vy) || 1; r.vx /= m; r.vy /= m;
  }

  // ---------- simulation ----------
  loop(t) {
    this.raf = requestAnimationFrame(tt => this.loop(tt));
    this.acc += Math.min(100, t - this.last) * (this.timeScale || 1); this.last = t;
    const stepMs = 1000 / FPS;
    while (this.acc >= stepMs) { this.acc -= stepMs; this.step(); }
    this.render();
  }

  step() {
    this.frame++;
    for (const pt of this.particles) { pt.x += pt.vx; pt.y += pt.vy; pt.life--; }
    this.particles = this.particles.filter(pt => pt.life > 0);
    if (this.frame === 1 || this.frame === 51 || this.frame === 101) play('chat');
    if (this.frame < COUNTDOWN) return;
    if (this.frame === COUNTDOWN) play('start');
    if (this.over) return;
    this.t++;
    if (this.t === this.gateFrame) { this.dirty = true; this.fieldDirty = true; if (this.gateFrame > 0) play('powerdown'); }
    for (const [i, at] of this.itemBack) if (this.t >= at) { this.itemBack.delete(i); this.dirty = true; }

    this.movePushers();

    for (const r of this.racers) {
      if (r.done) continue;
      if (r.kind === 'remote') {
        if (r.tx != null) { r.x += (r.tx - r.x) * 0.35; r.y += (r.ty - r.y) * 0.35; }
        continue;
      }
      if (this.t < r.frozenUntil) continue;
      const s = this.speedOf(r);
      if (r.kind === 'auto' || r.kind === 'ai') {
        if (r.kind === 'ai') {
          this.steer(r);
          if (r.hold) {
            const m = Math.min(s, r.holdDist);
            if (m > 0.05) { this.tryMove(r, r.vx * m, 0); this.tryMove(r, 0, r.vy * m); }
            this.touchTiles(r);
            continue;
          }
        }
        const n = Math.ceil(s);
        for (let k = 0; k < n; k++) {
          if (this.tryMove(r, (r.vx * s) / n, 0)) { r.vx = -r.vx; this.nudge(r); }
          if (this.tryMove(r, 0, (r.vy * s) / n)) { r.vy = -r.vy; this.nudge(r); }
        }
      } else {
        let dx = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0), dy = (this.keys.d ? 1 : 0) - (this.keys.u ? 1 : 0);
        if (!dx && !dy && this.pointer) {
          const px = this.pointer.x - r.x, py = this.pointer.y - r.y;
          if (px * px + py * py > 16) { dx = px; dy = py; }
        }
        const l = Math.sqrt(dx * dx + dy * dy);
        r.vx = l ? dx / l : 0; r.vy = l ? dy / l : 0;
        const n = Math.ceil(s);
        for (let k = 0; k < n; k++) { this.tryMove(r, (r.vx * s) / n, 0); this.tryMove(r, 0, (r.vy * s) / n); }
      }
      this.touchTiles(r);
      if (this.over) return;
    }

    if (this.movement !== 'player') this.collideRacers();

    const timeUp = this.t >= this.timeLimit;
    if (this.local) {
      // player mode: report as soon as *you* finish (or die); keep showing the others afterwards
      const raceStopped = this.stopOnWin && this.placeN > 0;
      if ((this.local.done || timeUp || raceStopped) && !this.localEnded) {
        this.localEnded = true;
        const cleared = this.local.done && !this.local.dead;
        this.opts.onEnd?.({ cleared, dead: this.local.dead, time: Math.round((cleared ? this.local.time : this.timeLimit) / FPS * 10) / 10, racers: this.results() });
      }
      if (timeUp || raceStopped || (!this.opts.online && this.racers.every(r => r.done))) this.over = true;
    } else if (this.racers.every(r => r.done) || timeUp || (this.stopOnWin && this.placeN > 0)) this.finishRace();
  }

  applyTool(r, tool, i) {
    if (tool === 'speed') { r.boostUntil = this.t + 4 * FPS; this.toast(r, '💨 سرعة'); }
    else if (tool === 'ghost') { r.ghostUntil = this.t + 4 * FPS; this.toast(r, '👻 يخترق البلوكات'); }
    else if (tool === 'freeze') {
      for (const o of this.racers) if (o !== r && !o.done) o.frozenUntil = this.t + 2 * FPS;
      play('zap'); this.toast(r, '❄ جمّد الباقين');
    } else {
      const c0 = i % this.cols, r0 = Math.floor(i / this.cols);
      for (let y = r0 - 2; y <= r0 + 2; y++) for (let x = c0 - 2; x <= c0 + 2; x++) {
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        const j = y * this.cols + x;
        if (this.cells[j] === T.BREAK) { this.breakCell(j); this.opts.onBreak?.(j); }
      }
      play('boom'); this.toast(r, '💣 تفجير');
    }
  }

  touchTiles(r) {
    const { v, i } = this.tileAt(r.x, r.y);
    if (v === T.BOOST) { if (this.t >= r.boostUntil - 30) play('zap'); r.boostUntil = Math.max(r.boostUntil, this.t + 45); }
    if (isItem(v) && !this.itemBack.has(i)) {
      this.itemBack.set(i, this.t + 6 * FPS); this.dirty = true;
      const tool = TOOL[v] || ['speed', 'ghost', 'bomb', 'freeze'][Math.floor(this.rng() * 4)];
      this.applyTool(r, tool, i);
      play('item');
    }
    if (v === T.FINISH && !r.done) {
      r.done = true; r.place = ++this.placeN; r.time = this.t;
      play(r.place === 1 ? 'win' : 'coin');
      if (r.place === 1 && this.stopOnWin) this.opts.onToast?.(`🏆 ${r.name} فاز! السباق وقف`);
      this.opts.onPlace?.(r);
    }
  }

  toast(r, msg) { if (r.kind === 'local' || this.movement !== 'player') this.opts.onToast?.(`${r.name}: ${msg}`); }

  collideRacers() {
    const rs = this.racers;
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
      const A = rs[a], B = rs[b];
      if (A.done || B.done) continue;
      const ox = 2 * HALF - Math.abs(A.x - B.x), oy = 2 * HALF - Math.abs(A.y - B.y);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) {
        const d = A.x < B.x ? -1 : 1;
        if (!this.hits(A.x + d * ox / 2, A.y, false).length) A.x += d * ox / 2;
        if (!this.hits(B.x - d * ox / 2, B.y, false).length) B.x -= d * ox / 2;
        const t = A.vx; A.vx = B.vx; B.vx = t;
      } else {
        const d = A.y < B.y ? -1 : 1;
        if (!this.hits(A.x, A.y + d * oy / 2, false).length) A.y += d * oy / 2;
        if (!this.hits(B.x, B.y - d * oy / 2, false).length) B.y -= d * oy / 2;
        const t = A.vy; A.vy = B.vy; B.vy = t;
      }
    }
  }

  results() {
    return this.racers.map(r => ({ k: r.k, id: r.id, name: r.name, color: r.color, place: r.place, dead: r.dead, time: r.done && !r.dead ? Math.round((r.time / FPS) * 10) / 10 : null }));
  }

  finishRace() {
    if (this.over) return;
    this.over = true;
    this.opts.onEnd?.({ racers: this.results(), time: this.t / FPS });
  }

  // ---------- network (player mode) ----------
  snapshot() { return this.local ? { p: [Math.round(this.local.x), Math.round(this.local.y)], dn: this.local.done && !this.local.dead ? this.local.time : 0, dead: this.local.dead ? 1 : 0 } : {}; }
  applyPeer(id, d) {
    const r = this.racers.find(x => x.id === id); if (!r) return;
    if (d.p) { r.tx = d.p[0]; r.ty = d.p[1]; }
    for (const i of d.k || []) this.breakCell(i);
    if (d.dead && !r.done) { r.done = true; r.dead = true; this.opts.onToast?.(`💀 ${r.name} انعصر!`); }
    if (d.dn && !r.done) { r.done = true; r.time = d.dn; r.place = ++this.placeN; play('coin'); }
  }

  // ---------- rendering ----------
  renderLayer() {
    const c = this.layer.getContext('2d'), open = this.gatesOpen();
    for (let r = 0; r < this.rows; r++) for (let k = 0; k < this.cols; k++) {
      const i = r * this.cols + k;
      drawMazeTile(c, this.cells[i], k, r, MC, open, !this.itemBack.has(i), (this.hp.get(i) ?? this.breakHp) / this.breakHp, true);
      // item boxes keep their original tile value, so they render via cells[]
    }
    // pusher tracks
    c.strokeStyle = 'rgba(192,57,43,.35)'; c.setLineDash([3, 3]); c.lineWidth = 1;
    for (const p of this.pushers) {
      if (!p.travel) continue;
      c.strokeRect(Math.min(p.ox, p.ox + p.dx * p.travel * MC) + 0.5, Math.min(p.oy, p.oy + p.dy * p.travel * MC) + 0.5,
        (Math.abs(p.dx) * p.travel + 1) * MC - 1, (Math.abs(p.dy) * p.travel + 1) * MC - 1);
    }
    c.setLineDash([]);
    drawEdges(c, this.cells, this.cols, this.rows, MC);
    this.dirty = false;
  }

  render() {
    const c = this.ctx;
    if (this.dirty) this.renderLayer();
    c.drawImage(this.layer, 0, 0);
    for (const p of this.pushers) drawPusherBlock(c, p.x, p.y, MC, p.v);
    for (const pt of this.particles) { c.globalAlpha = pt.life / 30; c.fillStyle = pt.col; c.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3); }
    c.globalAlpha = 1;
    for (const r of this.racers) {
      if (r.dead) {
        c.globalAlpha = 0.45; c.fillStyle = r.color; c.fillRect(r.x - HALF, r.y - 2, HALF * 2, 4); c.globalAlpha = 1;
        c.font = '9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('💀', r.x, r.y - 2);
        continue;
      }
      const sp = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
      if (!r.done && sp > 0.01 && this.frame >= COUNTDOWN && r.kind !== 'remote' && this.t >= r.frozenUntil) {
        // motion trail
        const nx = r.vx / sp, ny = r.vy / sp, L = this.t < r.boostUntil ? 26 : 16;
        c.fillStyle = r.color + '88';
        c.beginPath();
        c.moveTo(r.x - nx * L, r.y - ny * L);
        c.lineTo(r.x - ny * HALF, r.y + nx * HALF);
        c.lineTo(r.x + ny * HALF, r.y - nx * HALF);
        c.closePath(); c.fill();
      }
      c.globalAlpha = this.t < r.ghostUntil ? 0.5 : 1;
      c.fillStyle = r.color; c.fillRect(r.x - HALF, r.y - HALF, HALF * 2, HALF * 2);
      if (this.t < r.frozenUntil) { c.fillStyle = 'rgba(180,230,255,.7)'; c.fillRect(r.x - HALF, r.y - HALF, HALF * 2, HALF * 2); }
      const mine = r.kind === 'local' || r.k === this.opts.pick;
      c.strokeStyle = mine ? '#fff' : '#111'; c.lineWidth = mine ? 2 : 1;
      c.strokeRect(r.x - HALF + 0.5, r.y - HALF + 0.5, HALF * 2 - 1, HALF * 2 - 1);
      c.globalAlpha = 1;
      if (r.done) {
        c.fillStyle = '#111'; c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : '#' + r.place, r.x, r.y - HALF - 1);
      } else if (this.opts.online && r.name) {
        c.fillStyle = 'rgba(0,0,0,.65)'; c.font = '8px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(r.name, r.x, r.y - HALF - 1);
      }
    }
    if (this.frame < COUNTDOWN) {
      const n = 3 - Math.floor(this.frame / 50);
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, this.W, this.H);
      c.fillStyle = '#fff'; c.font = `bold ${Math.round(Math.min(this.W, this.H) / 4)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(n, this.W / 2, this.H / 2);
    }
  }
}
