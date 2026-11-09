// Game engine: grid of blocks (0 empty, 1 wall, 2+ = palette color), paddle, balls, falling items.
export const CELL = 10;
const OPEN_SPACE = 230;   // empty play area under the board
const MAX_BALLS = 250;
const FPS = 60;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const imgCache = new Map();
export function getImg(src) {
  if (!src) return null;
  let i = imgCache.get(src);
  if (!i) { i = new Image(); i.src = src; imgCache.set(src, i); }
  return i.complete && i.naturalWidth ? i : null;
}

const ms2f = ms => Math.max(1, Math.round(((Number(ms) || 0) / 1000) * FPS));

// Syntax check only: building a Function does not run it. Item code itself only ever runs
// inside the isolated worker (item-worker.js).
export function checkItemCode(code) {
  new Function('api', '"use strict";\n' + (code || ''));
}

// Host side of the item sandbox: one worker per game, killed and restarted if code hangs.
const RUN_TIMEOUT_MS = 400;
export class ItemSandbox {
  constructor(codes, { onCommands, onError }) {
    this.codes = codes; this.onCommands = onCommands; this.onError = onError;
    this.disabled = new Set(); this.rid = 0; this.dead = false;
    this.spawn();
  }
  spawn() {
    this.ready = false; this.queue = []; this.pending = new Map();
    this.w = new Worker('item-worker.js');
    this.w.onmessage = e => this.onMsg(e.data);
    this.w.onerror = e => { e.preventDefault?.(); };
    this.w.postMessage({ t: 'init', codes: this.codes });
  }
  run(id, snap, tid) {
    if (this.dead || this.disabled.has(id)) return;
    const job = { t: 'run', rid: ++this.rid, id, tid, snap };
    if (this.ready) this.send(job); else this.queue.push(job);
  }
  send(job) {
    this.pending.set(job.rid, { id: job.id, job, to: setTimeout(() => this.timeout(job.rid), RUN_TIMEOUT_MS) });
    this.w.postMessage(job);
  }
  onMsg(m) {
    if (m.t === 'ready') { this.ready = true; const q = this.queue; this.queue = []; q.forEach(j => this.send(j)); return; }
    const p = this.pending.get(m.rid);
    if (!p) return;
    clearTimeout(p.to); this.pending.delete(m.rid);
    if (m.err) this.onError(m.err, p.id);
    if (Array.isArray(m.cmds) && m.cmds.length) this.onCommands(m.cmds, p.id);
  }
  timeout(rid) {
    const p = this.pending.get(rid);
    if (!p || this.dead) return;
    this.disabled.add(p.id);
    this.onError('الكود علّق (لوب لا نهائي؟) — تم إيقاف هذا الأيتم', p.id);
    this.w.terminate();
    // jobs waiting behind the stuck one get a fresh worker (timer callbacks of the old worker are lost)
    const retry = [...this.pending.values()].filter(q => q.id !== p.id && !q.job.tid).map(q => q.job);
    for (const q of this.pending.values()) clearTimeout(q.to);
    this.spawn();
    this.queue = retry;
  }
  terminate() {
    this.dead = true; this.w.terminate();
    for (const q of this.pending.values()) clearTimeout(q.to);
    this.pending.clear();
  }
}

// Commands the sandboxed code may ask the host to perform.
const ALLOWED_CMDS = new Set(['multiplyBalls', 'spawnBalls', 'scalePaddle', 'ballSpeed', 'pierce', 'shield', 'laser', 'setPaddleColor',
  'setCell', 'setBall', 'destroyAt', 'explode', 'destroyRandom', 'destroyColor', 'addScore', 'addLife', 'toast']);

export function boardSize(map) {
  return { W: map.cols * CELL, H: map.rows * CELL + OPEN_SPACE };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

export function drawCell(ctx, map, v, c, r, size, crisp = true) {
  const x = c * size, y = r * size;
  if (v === 1) {
    ctx.fillStyle = '#8b8b8b'; ctx.fillRect(x, y, size, size);
    if (crisp) { ctx.fillStyle = '#6a6a6a'; ctx.fillRect(x + size - 1, y, 1, size); ctx.fillRect(x, y + size - 1, size, 1); }
  } else if (v >= 2) {
    const col = map.palette[v - 2] || '#ff00ff';
    ctx.fillStyle = col; ctx.fillRect(x, y, size, size);
    if (crisp) { ctx.fillStyle = shade(col, 0.72); ctx.fillRect(x + size - 1, y, 1, size); ctx.fillRect(x, y + size - 1, size, 1); }
  }
}

export function drawMapPreview(canvas, map, scale = 3) {
  canvas.width = map.cols * scale; canvas.height = map.rows * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) drawCell(ctx, map, map.cells[r * map.cols + c], c, r, scale, false);
}

export class Game {
  constructor(canvas, map, items, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.map = { ...map, palette: [...map.palette] };
    this.opts = opts;
    this.cols = map.cols; this.rows = map.rows;
    const { W, H } = boardSize(map);
    this.W = W; this.H = H; this.boardH = map.rows * CELL;
    canvas.width = W; canvas.height = H;
    this.cells = Int16Array.from(map.cells);
    this.remaining = 0; for (const v of this.cells) if (v >= 2) this.remaining++;
    this.rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 1e9));
    this.items = items || {};
    this.pool = (map.items || []).filter(id => this.items[id]);
    this.sandbox = new ItemSandbox(Object.fromEntries(this.pool.map(id => [id, this.items[id].code || ''])), {
      onCommands: (cmds, id) => this.applyCommands(cmds, id),
      onError: msg => this.opts.onToast?.('⚠ خطأ في كود الأيتم: ' + msg),
    });
    this.baseSpeed = map.ballSpeed || 5;
    const skin = opts.skin || {};
    const pw = map.paddleWidth || 100;
    this.paddle = { w: pw, h: 10, x: W / 2 - pw / 2, y: H - 36, color: skin.color || '#ff6b5a', texture: skin.texture || '' };
    this.balls = []; this.drops = []; this.bullets = []; this.timers = []; this.particles = [];
    this.score = 0; this.lives = map.lives || 3; this.frame = 0; this.over = false;
    this.speedMult = 1; this.pierceUntil = 0; this.shieldUntil = 0; this.laserUntil = 0;
    this.targetX = W / 2; this.keys = {};
    this.layer = document.createElement('canvas');
    this.layer.width = W; this.layer.height = this.boardH;
    this.renderLayer();
    this.buildApi();
    this.resetBall();
    this.bindInput();
    this.last = performance.now(); this.acc = 0;
    this.raf = requestAnimationFrame(t => this.loop(t));
  }

  // ---------- item API (what item code can call) ----------
  buildApi() {
    const g = this;
    const speed = () => g.baseSpeed * g.speedMult;
    const api = {
      get balls() { return g.balls; },
      get paddle() { return g.paddle; },
      get score() { return g.score; },
      get lives() { return g.lives; },
      get remaining() { return g.remaining; },
      get time() { return g.frame / FPS; },
      cols: g.cols, rows: g.rows, cellSize: CELL, width: g.W, height: g.H,
      random: () => g.rng(),
      after(ms, fn) { g.timers.push({ at: g.frame + ms2f(ms), fn }); },
      every(ms, fn, times = Infinity) {
        let n = 0;
        const tick = () => { if (g.over) return; g.safe(fn); if (++n < times) api.after(ms, tick); };
        api.after(ms, tick);
      },
      toast(text) { g.opts.onToast?.(String(text).slice(0, 120)); },
      addScore(n = 1) { g.score += Math.max(-1e6, Math.min(1e6, Number(n) || 0)); },
      addLife(n = 1) { g.lives = Math.max(1, Math.min(9, g.lives + (Number(n) || 0))); },
      setBall(i, props) {
        const b = g.balls[i];
        if (!b || !props || typeof props !== 'object') return;
        for (const k of ['x', 'y', 'vx', 'vy']) if (Number.isFinite(props[k])) b[k] = props[k];
      },
      spawnBalls(n = 1) {
        const p = g.paddle;
        for (let i = 0; i < n && g.balls.length < MAX_BALLS; i++) {
          const a = -Math.PI / 2 + (g.rng() - 0.5) * 1.6;
          g.balls.push({ x: p.x + p.w / 2, y: p.y - 6, vx: Math.cos(a) * speed(), vy: Math.sin(a) * speed(), r: 4 });
        }
      },
      multiplyBalls(n = 3) {
        const add = [];
        for (const b of g.balls) {
          if (b.stuck) continue;
          for (let k = 0; k < n; k++) {
            if (g.balls.length + add.length >= MAX_BALLS) break;
            const a = Math.atan2(b.vy, b.vx) + (g.rng() - 0.5) * 2.2;
            add.push({ x: b.x, y: b.y, vx: Math.cos(a) * speed(), vy: Math.sin(a) * speed(), r: b.r });
          }
        }
        if (!add.length) api.spawnBalls(n);
        g.balls.push(...add);
      },
      scalePaddle(f = 1.5, ms = 10000) {
        const p = g.paddle, old = p.w;
        p.w = Math.max(20, Math.min(g.W, p.w * f));
        const d = p.w - old;
        api.after(ms, () => { p.w = Math.max(20, p.w - d); });
      },
      ballSpeed(mult = 1.5, ms = 8000) { g.speedMult *= mult; api.after(ms, () => { g.speedMult /= mult; }); },
      pierce(ms = 6000) { g.pierceUntil = Math.max(g.pierceUntil, g.frame + ms2f(ms)); },
      shield(ms = 10000) { g.shieldUntil = Math.max(g.shieldUntil, g.frame + ms2f(ms)); },
      laser(ms = 7000) { g.laserUntil = Math.max(g.laserUntil, g.frame + ms2f(ms)); },
      setPaddleColor(color, ms = 0) {
        const old = g.paddle.color; g.paddle.color = color;
        if (ms) api.after(ms, () => { g.paddle.color = old; });
      },
      cellAt(c, r) {
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return null;
        const v = g.cells[r * g.cols + c];
        return v === 0 ? 'empty' : v === 1 ? 'wall' : g.map.palette[v - 2];
      },
      setCell(c, r, value) {
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return;
        const i = r * g.cols + c, old = g.cells[i];
        let v = 0;
        if (value === 'wall') v = 1;
        else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
          let k = g.map.palette.indexOf(value);
          if (k < 0) { g.map.palette.push(value); k = g.map.palette.length - 1; }
          v = k + 2;
        }
        if (old >= 2) g.remaining--;
        if (v >= 2) g.remaining++;
        g.cells[i] = v; g.redrawCell(i);
        g.opts.onCellSet?.(i, v, v >= 2 ? g.map.palette[v - 2] : null);
      },
      destroyAt(c, r) { if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) g.destroy(r * g.cols + c, false); },
      explode(x, y, radius = 30) {
        const r2 = radius * radius;
        for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
          const dx = c * CELL + CELL / 2 - x, dy = r * CELL + CELL / 2 - y;
          if (dx * dx + dy * dy <= r2) g.destroy(r * g.cols + c, false);
        }
      },
      destroyRandom(n = 5) {
        const list = [];
        g.cells.forEach((v, i) => { if (v >= 2) list.push(i); });
        for (let k = 0; k < n && list.length; k++) g.destroy(list.splice(Math.floor(g.rng() * list.length), 1)[0], false);
      },
      destroyColor(hex) {
        const k = g.map.palette.indexOf(hex) + 2;
        if (k >= 2) g.cells.forEach((v, i) => { if (v === k) g.destroy(i, false); });
      },
    };
    this.api = api;
  }

  safe(fn) {
    try { fn(); } catch (e) { this.opts.onToast?.('⚠ خطأ في كود الأيتم: ' + e.message); }
  }

  // What the sandboxed item code can see (a copy - edits there do nothing here).
  sandboxSnap() {
    const p = this.paddle;
    return {
      balls: this.balls.slice(0, MAX_BALLS).map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r })),
      paddle: { x: p.x, y: p.y, w: p.w, h: p.h, color: p.color },
      score: this.score, lives: this.lives, remaining: this.remaining, time: this.frame / FPS,
      cols: this.cols, rows: this.rows, cellSize: CELL, width: this.W, height: this.H,
      cells: this.cells, palette: this.map.palette,
    };
  }

  applyCommands(cmds, id) {
    for (const c of cmds) {
      if (this.over || !Array.isArray(c)) return;
      const [name, ...args] = c;
      if (name === 'after') {
        const tid = args[0];
        this.timers.push({ at: this.frame + ms2f(args[1]), fn: () => this.sandbox.run(id, this.sandboxSnap(), tid) });
        continue;
      }
      if (!ALLOWED_CMDS.has(name)) continue;
      const clean = args.map(a => (['number', 'string', 'boolean'].includes(typeof a) ? a : name === 'setBall' && a && typeof a === 'object' ? a : undefined));
      this.safe(() => this.api[name](...clean));
    }
  }

  // ---------- input ----------
  bindInput() {
    const cv = this.cv;
    this.onMove = e => {
      const r = cv.getBoundingClientRect();
      this.targetX = ((e.clientX - r.left) / r.width) * this.W;
    };
    this.onDown = e => { this.onMove(e); this.launch(); };
    this.onKey = e => {
      const down = e.type === 'keydown';
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) this.keys.left = down;
      if (['ArrowRight', 'd', 'D'].includes(e.key)) this.keys.right = down;
      if (down && (e.key === ' ' || e.key === 'ArrowUp')) { this.launch(); e.preventDefault(); }
    };
    window.addEventListener('pointermove', this.onMove);
    cv.addEventListener('pointerdown', this.onDown);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  destroyGame() {
    cancelAnimationFrame(this.raf);
    this.over = true;
    this.sandbox.terminate();
    window.removeEventListener('pointermove', this.onMove);
    this.cv.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  launch() {
    for (const b of this.balls) if (b.stuck) {
      b.stuck = false;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      const s = this.baseSpeed * this.speedMult;
      b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s;
    }
  }

  resetBall() {
    this.balls = [{ x: 0, y: 0, vx: 0, vy: 0, r: 4, stuck: true }];
  }

  // ---------- simulation ----------
  loop(t) {
    this.raf = requestAnimationFrame(tt => this.loop(tt));
    this.acc += Math.min(100, t - this.last); this.last = t;
    const stepMs = 1000 / FPS;
    while (this.acc >= stepMs) { this.acc -= stepMs; if (!this.over) this.step(); }
    this.render();
  }

  step() {
    this.frame++;
    const due = this.timers.filter(tm => tm.at <= this.frame);
    if (due.length) { this.timers = this.timers.filter(tm => tm.at > this.frame); for (const tm of due) this.safe(tm.fn); }

    const p = this.paddle;
    if (this.keys.left) this.targetX = Math.min(this.targetX, p.x + p.w / 2) - 9;
    if (this.keys.right) this.targetX = Math.max(this.targetX, p.x + p.w / 2) + 9;
    this.targetX = Math.max(0, Math.min(this.W, this.targetX));
    p.x = Math.max(0, Math.min(this.W - p.w, this.targetX - p.w / 2));

    const s = this.baseSpeed * this.speedMult;
    const pierce = this.frame < this.pierceUntil;
    for (const b of this.balls) {
      if (b.stuck) { b.x = p.x + p.w / 2; b.y = p.y - b.r - 1; continue; }
      const len = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / len) * s; b.vy = (b.vy / len) * s;
      if (Math.abs(b.vy) < s * 0.25) { b.vy = Math.sign(b.vy || -1) * s * 0.25; b.vx = Math.sign(b.vx || 1) * Math.sqrt(s * s - b.vy * b.vy); }
      const n = Math.ceil(s / 2);
      for (let k = 0; k < n && !b.dead; k++) this.moveBall(b, 1 / n, pierce);
    }
    this.balls = this.balls.filter(b => !b.dead);
    if (!this.balls.length && !this.over) {
      this.lives--;
      this.opts.onToast?.(this.lives > 0 ? `💔 باقي ${this.lives}` : '');
      if (this.lives <= 0) return this.end(false);
      this.resetBall();
    }

    for (const d of this.drops) {
      d.y += 2.2;
      if (d.y + 11 >= p.y && d.y - 11 <= p.y + p.h && d.x + 11 >= p.x && d.x - 11 <= p.x + p.w) {
        d.dead = true;
        this.sandbox.run(d.id, this.sandboxSnap());
        this.opts.onItem?.(this.items[d.id]);
      } else if (d.y > this.H + 20) d.dead = true;
    }
    this.drops = this.drops.filter(d => !d.dead);

    if (this.frame < this.laserUntil && this.frame % 15 === 0) {
      this.bullets.push({ x: p.x + 4, y: p.y }, { x: p.x + p.w - 4, y: p.y });
    }
    for (const bl of this.bullets) {
      bl.y -= 7;
      const c = Math.floor(bl.x / CELL), r = Math.floor(bl.y / CELL);
      if (bl.y < 0) bl.dead = true;
      else if (r < this.rows && c >= 0 && c < this.cols) {
        const v = this.cells[r * this.cols + c];
        if (v === 1) bl.dead = true;
        else if (v >= 2) { this.destroy(r * this.cols + c, true); bl.dead = true; }
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);

    for (const pt of this.particles) { pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.15; pt.life--; }
    this.particles = this.particles.filter(pt => pt.life > 0);

    if (this.remaining <= 0 && !this.over) this.end(true);
  }

  hit(x, y, pierce) {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    const i = r * this.cols + c, v = this.cells[i];
    if (v === 0) return false;
    if (v === 1) return true;
    this.destroy(i, true);
    return !pierce;
  }

  moveBall(b, f, pierce) {
    const r = b.r, p = this.paddle;
    let nx = b.x + b.vx * f;
    if (nx - r < 0) { nx = r; b.vx = Math.abs(b.vx); }
    else if (nx + r > this.W) { nx = this.W - r; b.vx = -Math.abs(b.vx); }
    else if (this.hit(nx + Math.sign(b.vx) * r, b.y, pierce)) { b.vx = -b.vx; nx = b.x; }
    b.x = nx;
    let ny = b.y + b.vy * f;
    if (ny - r < 0) { ny = r; b.vy = Math.abs(b.vy); }
    else if (this.hit(b.x, ny + Math.sign(b.vy) * r, pierce)) { b.vy = -b.vy; ny = b.y; }
    b.y = ny;
    if (b.vy > 0 && b.y + r >= p.y && b.y - r <= p.y + p.h && b.x >= p.x - r && b.x <= p.x + p.w + r) {
      const rel = Math.max(-1, Math.min(1, (b.x - (p.x + p.w / 2)) / (p.w / 2)));
      const a = rel * 1.1, s = Math.hypot(b.vx, b.vy);
      b.vx = Math.sin(a) * s; b.vy = -Math.cos(a) * s; b.y = p.y - r;
    }
    if (this.frame < this.shieldUntil && b.vy > 0 && b.y + r >= this.H - 6) b.vy = -Math.abs(b.vy);
    if (b.y - r > this.H) b.dead = true;
  }

  destroy(i, canDrop) {
    const v = this.cells[i];
    if (v < 2) return;
    this.cells[i] = 0; this.remaining--; this.score++;
    this.redrawCell(i);
    const cx = (i % this.cols) * CELL + CELL / 2, cy = Math.floor(i / this.cols) * CELL + CELL / 2;
    const col = this.map.palette[v - 2];
    if (this.particles.length < 400) for (let k = 0; k < 3; k++) this.particles.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.8) * 3, life: 20, col });
    this.opts.onDestroy?.(i);
    if (canDrop && this.pool.length && this.rng() < (this.map.dropChance ?? 0.1)) {
      this.drops.push({ x: cx, y: cy, id: this.pool[Math.floor(this.rng() * this.pool.length)] });
    }
  }

  end(cleared) {
    this.over = true;
    this.opts.onEnd?.({ score: this.score, cleared, lives: this.lives, time: Math.round((this.frame / FPS) * 10) / 10 });
  }

  // ---------- rendering ----------
  renderLayer() {
    const ctx = this.layer.getContext('2d');
    ctx.clearRect(0, 0, this.W, this.boardH);
    for (let i = 0; i < this.cells.length; i++) this.redrawCell(i, ctx);
  }
  redrawCell(i, ctx = this.layer.getContext('2d')) {
    const c = i % this.cols, r = Math.floor(i / this.cols);
    ctx.clearRect(c * CELL, r * CELL, CELL, CELL);
    drawCell(ctx, this.map, this.cells[i], c, r, CELL);
  }

  render() {
    const c = this.ctx, p = this.paddle;
    c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, this.W, this.H);
    c.drawImage(this.layer, 0, 0);

    if (this.frame < this.shieldUntil) { c.fillStyle = '#5b8cff'; c.fillRect(0, this.H - 4, this.W, 4); }

    for (const d of this.drops) {
      const it = this.items[d.id], img = getImg(it?.icon);
      c.save(); c.beginPath(); c.arc(d.x, d.y, 11, 0, Math.PI * 2);
      if (img) { c.clip(); c.imageSmoothingEnabled = false; c.drawImage(img, d.x - 11, d.y - 11, 22, 22); }
      else {
        c.fillStyle = it?.color || '#19b5d8'; c.fill();
        c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(it?.label || '?', d.x, d.y + 1);
      }
      c.restore();
    }

    c.fillStyle = '#ff5050';
    for (const bl of this.bullets) c.fillRect(bl.x - 1, bl.y - 6, 2, 8);

    for (const pt of this.particles) { c.globalAlpha = pt.life / 20; c.fillStyle = pt.col; c.fillRect(pt.x, pt.y, 2, 2); }
    c.globalAlpha = 1;

    const pierce = this.frame < this.pierceUntil;
    c.fillStyle = pierce ? '#ffb347' : '#fff';
    for (const b of this.balls) { c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill(); }

    const tex = getImg(p.texture);
    c.save();
    c.beginPath(); c.roundRect ? c.roundRect(p.x, p.y, p.w, p.h, 3) : c.rect(p.x, p.y, p.w, p.h);
    c.clip();
    c.fillStyle = p.color; c.fillRect(p.x, p.y, p.w, p.h);
    if (tex) { c.imageSmoothingEnabled = false; c.drawImage(tex, p.x, p.y, p.w, p.h); }
    if (this.frame < this.laserUntil) { c.fillStyle = '#ff5050'; c.fillRect(p.x, p.y, 4, p.h); c.fillRect(p.x + p.w - 4, p.y, 4, p.h); }
    c.restore();

    if (this.balls.some(b => b.stuck) && !this.over) {
      c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '14px sans-serif'; c.textAlign = 'center'; c.direction = 'rtl';
      c.fillText('اضغط / Space للإطلاق', this.W / 2, this.H - 70);
    }
  }

  snapshot() {
    return { px: Math.round(this.paddle.x), pw: Math.round(this.paddle.w), b: this.balls.slice(0, 30).map(b => [Math.round(b.x), Math.round(b.y)]), s: this.score, l: this.lives, r: this.remaining };
  }
}

// Small live view of an opponent's board.
export class Mini {
  constructor(canvas, map, color) {
    this.cv = canvas; this.map = { ...map, palette: [...map.palette] }; this.color = color;
    this.cells = Int16Array.from(map.cells);
    const { W, H } = boardSize(map);
    this.W = W; this.H = H; this.scale = Math.min(1, 200 / W);
    canvas.width = Math.round(W * this.scale); canvas.height = Math.round(H * this.scale);
    this.px = W / 2; this.pw = map.paddleWidth || 100; this.balls = [];
  }
  apply(d) {
    for (const i of d.k || []) this.cells[i] = 0;
    for (const [i, v, col] of d.set || []) {
      if (col) { let k = this.map.palette.indexOf(col); if (k < 0) { this.map.palette.push(col); k = this.map.palette.length - 1; } this.cells[i] = k + 2; }
      else this.cells[i] = v;
    }
    if (d.px != null) { this.px = d.px; this.pw = d.pw; this.balls = d.b || []; }
  }
  render() {
    const c = this.cv.getContext('2d'), s = this.scale, cs = CELL * s;
    c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, this.cv.width, this.cv.height);
    for (let r = 0; r < this.map.rows; r++) for (let k = 0; k < this.map.cols; k++) {
      const v = this.cells[r * this.map.cols + k];
      if (v) { c.fillStyle = v === 1 ? '#8b8b8b' : this.map.palette[v - 2]; c.fillRect(k * cs, r * cs, cs + 0.5, cs + 0.5); }
    }
    c.fillStyle = this.color; c.fillRect(this.px * s, (this.H - 36) * s, this.pw * s, 4);
    c.fillStyle = '#fff';
    for (const [x, y] of this.balls) c.fillRect(x * s - 1, y * s - 1, 3, 3);
  }
}
