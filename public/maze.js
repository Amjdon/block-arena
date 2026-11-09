// Maze Race mode: colored squares race through a maze to the checkered finish.
// movement 'auto'   -> squares bounce on their own (deterministic from the seed, so every client sees the same race)
// movement 'player' -> each player steers their own square; others are shown from network updates (or bots in solo)
import { play } from './sound.js';
import { mulberry32 } from './game.js';

export const MC = 16;          // pixels per maze cell
const HALF = 5;                // half size of a racer square
const FPS = 60;
const COUNTDOWN = 150;         // frames before the race starts

export const T = { FLOOR: 0, WALL: 1, BREAK: 2, FINISH: 3, GATE: 4, BOOST: 5, SLOW: 6, ITEM: 7 };
export const TILE_INFO = [
  { name: 'أرضية', icon: '⬜' },
  { name: 'جدار', icon: '🧱' },
  { name: 'بلوك ينكسر', icon: '⬛' },
  { name: 'خط النهاية', icon: '🏁' },
  { name: 'بوابة (تفتح بعد وقت)', icon: '🚪' },
  { name: 'تسريع', icon: '⚡' },
  { name: 'طين (تبطيء)', icon: '🟫' },
  { name: 'صندوق أيتم', icon: '🎁' },
];
export const RACER_COLORS = ['#e53935', '#1e6fff', '#11865a', '#f5c518', '#9c27b0', '#ff7a00', '#00bcd4', '#ec407a'];
export const RACER_NAMES = ['الأحمر', 'الأزرق', 'الأخضر', 'الأصفر', 'البنفسجي', 'البرتقالي', 'السماوي', 'الوردي'];

const COL = { floor: '#e3e3dd', wall: '#a7a7a7', edge: '#4a4a4a', brk: '#2c3142', gate: '#3f36a0', boost: '#ffd34d', slow: '#8a6a45', item: '#9d7bff' };

// Draws one tile. `open` = gates are open, `itemOn` = item box present.
export function drawMazeTile(ctx, v, c, r, s, open = false, itemOn = true, hpFrac = 1) {
  const x = c * s, y = r * s;
  ctx.fillStyle = v === T.WALL ? COL.wall : COL.floor;
  ctx.fillRect(x, y, s, s);
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
    case T.ITEM:
      if (itemOn) {
        ctx.fillStyle = COL.item; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
        ctx.strokeStyle = '#4b2fa8'; ctx.lineWidth = 1; ctx.strokeRect(x + 3.5, y + 3.5, s - 7, s - 7);
        ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(s * 0.5)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', x + s / 2, y + s / 2 + 1);
      }
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

export class MazeGame {
  // racers: [{ color, name, kind: 'auto' | 'local' | 'remote', id }]
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

    const starts = map.starts?.length ? map.starts : [this.cols + 1];
    this.racers = (opts.racers || []).map((rc, k) => {
      const si = starts[k % starts.length];
      const r = {
        ...rc, k, x: (si % this.cols) * MC + MC / 2, y: Math.floor(si / this.cols) * MC + MC / 2,
        vx: 0, vy: 0, done: false, place: 0, time: 0, boostUntil: 0, ghostUntil: 0, tx: null, ty: null,
      };
      if (r.kind === 'auto') {
        // random direction without trig (sqrt is exact, so every browser gets the same race)
        let dx = this.rng() * 2 - 1, dy = this.rng() * 2 - 1;
        if (Math.abs(dx) < 0.25) dx = dx < 0 ? -0.25 : 0.25;
        if (Math.abs(dy) < 0.25) dy = dy < 0 ? -0.25 : 0.25;
        const l = Math.sqrt(dx * dx + dy * dy); r.vx = dx / l; r.vy = dy / l;
      }
      return r;
    });
    this.local = this.racers.find(r => r.kind === 'local') || null;
    this.bindInput();
    this.last = performance.now(); this.acc = 0;
    this.raf = requestAnimationFrame(t => this.loop(t));
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
  // cells a racer box at (x,y) would overlap that are solid
  hits(x, y, ghost) {
    const out = [];
    const c0 = Math.floor((x - HALF) / MC), c1 = Math.floor((x + HALF - 0.001) / MC);
    const r0 = Math.floor((y - HALF) / MC), r1 = Math.floor((y + HALF - 0.001) / MC);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) { out.push(-1); continue; }
      const i = r * this.cols + c;
      if (this.solid(this.cells[i], ghost)) out.push(i);
    }
    return out;
  }
  damage(i) {
    if (i < 0 || this.cells[i] !== T.BREAK) return;
    const hp = (this.hp.get(i) ?? this.breakHp) - 1;
    if (hp <= 0) { this.breakCell(i); this.opts.onBreak?.(i); play('brick', 6); }
    else { this.hp.set(i, hp); this.dirty = true; play('wall'); }
  }
  breakCell(i) {
    if (this.cells[i] !== T.BREAK) return;
    this.cells[i] = T.FLOOR; this.hp.delete(i); this.dirty = true;
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
    let s = this.baseSpeed;
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

  // ---------- simulation ----------
  loop(t) {
    this.raf = requestAnimationFrame(tt => this.loop(tt));
    this.acc += Math.min(100, t - this.last); this.last = t;
    const stepMs = 1000 / FPS;
    while (this.acc >= stepMs) { this.acc -= stepMs; this.step(); }
    this.render();
  }

  step() {
    this.frame++;
    if (this.frame === 1 || this.frame === 51 || this.frame === 101) play('chat');
    if (this.frame < COUNTDOWN) return;
    if (this.frame === COUNTDOWN) play('start');
    if (this.over) return;
    this.t++;
    if (this.t === this.gateFrame) { this.dirty = true; if (this.gateFrame > 0) play('powerdown'); }
    for (const [i, at] of this.itemBack) if (this.t >= at) { this.itemBack.delete(i); this.dirty = true; }

    for (const r of this.racers) {
      if (r.done) continue;
      if (r.kind === 'remote') {
        if (r.tx != null) { r.x += (r.tx - r.x) * 0.35; r.y += (r.ty - r.y) * 0.35; }
        continue;
      }
      const s = this.speedOf(r);
      if (r.kind === 'auto') {
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
    }

    if (this.movement === 'auto') this.collideRacers();

    const timeUp = this.t >= this.timeLimit;
    if (this.local) {
      // player mode: report as soon as *you* finish; keep showing the others afterwards
      if ((this.local.done || timeUp) && !this.localEnded) {
        this.localEnded = true;
        this.opts.onEnd?.({ cleared: this.local.done, time: Math.round((this.local.done ? this.local.time : this.timeLimit) / FPS * 10) / 10, racers: this.results() });
      }
      if (timeUp || (!this.opts.online && this.racers.every(r => r.done))) this.over = true;
    } else if (this.racers.every(r => r.done) || timeUp) this.finishRace();
  }

  touchTiles(r) {
    const { v, i } = this.tileAt(r.x, r.y);
    if (v === T.BOOST) { if (this.t >= r.boostUntil - 30) play('zap'); r.boostUntil = Math.max(r.boostUntil, this.t + 45); }
    if (v === T.ITEM && !this.itemBack.has(i)) {
      this.itemBack.set(i, this.t + 6 * FPS); this.dirty = true;
      const roll = Math.floor(this.rng() * 3);
      if (roll === 0) { r.boostUntil = this.t + 4 * FPS; this.toast(r, '⚡ سرعة'); }
      else if (roll === 1) { r.ghostUntil = this.t + 4 * FPS; this.toast(r, '👻 يخترق البلوكات'); }
      else {
        // blast: break nearby breakable blocks
        const c0 = i % this.cols, r0 = Math.floor(i / this.cols);
        for (let y = r0 - 2; y <= r0 + 2; y++) for (let x = c0 - 2; x <= c0 + 2; x++) {
          if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
          const j = y * this.cols + x;
          if (this.cells[j] === T.BREAK) { this.breakCell(j); this.opts.onBreak?.(j); }
        }
        play('boom'); this.toast(r, '💣 تفجير');
      }
      play('item');
    }
    if (v === T.FINISH && !r.done) {
      r.done = true; r.place = ++this.placeN; r.time = this.t;
      play(r.place === 1 ? 'win' : 'coin');
      this.opts.onPlace?.(r);
    }
  }

  toast(r, msg) { if (r.kind === 'local' || this.movement === 'auto') this.opts.onToast?.(`${r.name}: ${msg}`); }

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
    return this.racers.map(r => ({ k: r.k, id: r.id, name: r.name, color: r.color, place: r.place, time: r.done ? Math.round((r.time / FPS) * 10) / 10 : null }));
  }

  finishRace() {
    if (this.over) return;
    this.over = true;
    this.opts.onEnd?.({ racers: this.results(), time: this.t / FPS });
  }

  // ---------- network (player mode) ----------
  snapshot() { return this.local ? { p: [Math.round(this.local.x), Math.round(this.local.y)], dn: this.local.done ? this.local.time : 0 } : {}; }
  applyPeer(id, d) {
    const r = this.racers.find(x => x.id === id); if (!r) return;
    if (d.p) { r.tx = d.p[0]; r.ty = d.p[1]; if (r.x === undefined) { r.x = r.tx; r.y = r.ty; } }
    for (const i of d.k || []) this.breakCell(i);
    if (d.dn && !r.done) { r.done = true; r.time = d.dn; r.place = ++this.placeN; play('coin'); }
  }

  // ---------- rendering ----------
  renderLayer() {
    const c = this.layer.getContext('2d'), open = this.gatesOpen();
    for (let r = 0; r < this.rows; r++) for (let k = 0; k < this.cols; k++) {
      const i = r * this.cols + k;
      drawMazeTile(c, this.cells[i], k, r, MC, open, !this.itemBack.has(i), (this.hp.get(i) ?? this.breakHp) / this.breakHp);
    }
    drawEdges(c, this.cells, this.cols, this.rows, MC);
    this.dirty = false;
  }

  render() {
    const c = this.ctx;
    if (this.dirty) this.renderLayer();
    c.drawImage(this.layer, 0, 0);
    for (const r of this.racers) {
      const sp = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
      if (!r.done && sp > 0.01 && this.frame >= COUNTDOWN && r.kind !== 'remote') {
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
      c.strokeStyle = r.kind === 'local' || r.k === this.opts.pick ? '#fff' : '#111';
      c.lineWidth = r.kind === 'local' || r.k === this.opts.pick ? 2 : 1;
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
