// Block Arena server: static files + sandbox API (maps/items) + WebSocket rooms.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { extraMazes, extraBreakout } = require('./builtin-maps');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');

// ---------- storage ----------
// With DATABASE_URL set (e.g. Supabase / Render Postgres) user content lives in Postgres,
// so it survives restarts on hosts with a wiped disk. Without it, JSON files in ./data are used.
// Everything is also kept in memory; the database is only written on change.
const store = { maps: {}, items: {} };
let db = null;

async function initStorage() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 4 });
    await db.query(`CREATE TABLE IF NOT EXISTS content (
      kind TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (kind, id))`);
    const { rows } = await db.query('SELECT kind, id, data FROM content');
    for (const r of rows) if (store[r.kind]) store[r.kind][r.id] = r.data;
    console.log(`storage: postgres (${rows.length} saved entries)`);
  } else {
    fs.mkdirSync(DATA, { recursive: true });
    for (const kind of ['maps', 'items']) {
      try { store[kind] = JSON.parse(fs.readFileSync(path.join(DATA, kind + '.json'), 'utf8')); } catch {}
    }
    console.log('storage: local files in ./data (set DATABASE_URL to use Postgres)');
  }
}

const saveTimers = {};
function persist(kind, id, removed = false) {
  if (db) {
    const q = removed
      ? db.query('DELETE FROM content WHERE kind = $1 AND id = $2', [kind, id])
      : db.query('INSERT INTO content (kind, id, data) VALUES ($1, $2, $3) ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data',
        [kind, id, store[kind][id]]);
    q.catch(e => console.error('db write failed:', e.message));
    return;
  }
  clearTimeout(saveTimers[kind]);
  saveTimers[kind] = setTimeout(() => fs.writeFile(path.join(DATA, kind + '.json'), JSON.stringify(store[kind]), () => {}), 300);
}

// ---------- built-in content ----------
const BUILTIN_ITEMS = [
  { id: 'multi3', name: '+3 كور', label: '+3', color: '#19b5d8', code: '// كل كورة تطلع منها 3 كور زيادة\napi.multiplyBalls(3);' },
  { id: 'wide', name: 'مضرب عريض', label: '↔', color: '#3ecf6e', code: 'api.scalePaddle(1.6, 10000);' },
  { id: 'slow', name: 'تبطيء', label: '🐢', color: '#f2b134', code: 'api.ballSpeed(0.6, 8000);' },
  { id: 'fire', name: 'كورة نارية', label: '🔥', color: '#ff6a3d', code: '// تخترق البلوكات الملونة 6 ثواني\napi.pierce(6000);' },
  { id: 'laser', name: 'ليزر', label: '⚡', color: '#c86bff', code: 'api.laser(7000);' },
  { id: 'shield', name: 'درع', label: '🛡', color: '#5b8cff', code: 'api.shield(10000);' },
  { id: 'life', name: 'حياة', label: '❤', color: '#ff4d6d', code: 'api.addLife(1);\napi.toast("حياة زيادة!");' },
  { id: 'bomb', name: 'قنبلة', label: '💣', color: '#555555', code: 'for (const b of api.balls) api.explode(b.x, b.y, 40);' },
];

function buildClassicMap() {
  const cols = 40, rows = 34, cells = new Array(cols * rows).fill(0);
  const set = (c, r, v) => { if (c >= 0 && c < cols && r >= 0 && r < rows) cells[r * cols + c] = v; };
  // palette index p -> cell value p + 2 ; 1 = wall
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) set(c, r, 2); // red
  for (let r = 18; r < rows - 2; r++) for (let c = 2; c < 20; c++) set(c, r, 3); // blue block
  for (let c = 1; c < 21; c++) set(c, 17, 1);
  for (let r = 17; r < rows - 1; r++) set(20, r, 1);
  set(10, 17, 0); set(11, 17, 0);
  for (let r = 6; r < 12; r++) for (let c = 26; c < 34; c++) if (Math.abs(c - 29.5) + Math.abs(r - 8.5) < 4) set(c, r, 4); // yellow diamond
  for (let c = 0; c < cols; c++) set(c, 0, 1);
  for (let r = 0; r < rows; r++) { set(0, r, 1); set(cols - 1, r, 1); }
  for (let c = 0; c < cols; c++) if (c < 15 || c > 24) set(c, rows - 1, 1); // bottom wall with an entrance
  return {
    id: 'classic', name: 'الكلاسيكية', author: 'النظام', authorId: 'system', cols, rows,
    palette: ['#c94a4a', '#3b5a8c', '#e0b040'], cells, dropChance: 0.08,
    items: BUILTIN_ITEMS.map(i => i.id), ballSpeed: 5, lives: 3, paddleWidth: 100, updated: 1,
  };
}

function buildRainbowMap() {
  const cols = 32, rows = 20, cells = new Array(cols * rows).fill(0);
  const palette = ['#ff5964', '#ff9f1c', '#ffe066', '#3ecf6e', '#2ec4b6', '#4d7cff', '#a35bff'];
  for (let r = 2; r < 16; r++) for (let c = 0; c < cols; c++) cells[r * cols + c] = 2 + Math.floor((r - 2) / 2);
  for (let c = 3; c < cols; c += 7) { cells[9 * cols + c] = 1; cells[9 * cols + c + 1] = 1; }
  return {
    id: 'rainbow', name: 'قوس قزح', author: 'النظام', authorId: 'system', cols, rows, palette, cells,
    dropChance: 0.12, items: ['multi3', 'wide', 'fire', 'laser', 'life'], ballSpeed: 5.5, lives: 3, paddleWidth: 90, updated: 2,
  };
}

// Maze race maps from ASCII art. # wall . floor B breakable F finish G gate > boost ~ mud ? item 1-8 start
// pushers: R right, L left, v down, ^ up. tools: s speed, g ghost, b bomb, f freeze
function mazeFromArt(id, name, art, opts, updated) {
  const cols = Math.max(...art.map(l => l.length)), rows = art.length, cells = [], starts = [];
  const code = { '#': 1, '.': 0, B: 2, F: 3, G: 4, '>': 5, '~': 6, '?': 7, R: 8, L: 9, v: 10, '^': 11, s: 12, g: 13, b: 14, f: 15 };
  art.forEach((line, r) => {
    for (let c = 0; c < cols; c++) {
      const ch = line[c] || '#';
      if (/[1-8]/.test(ch)) { starts[+ch - 1] = r * cols + c; cells.push(0); } else cells.push(code[ch] ?? 1);
    }
  });
  return {
    id, type: 'maze', name, author: 'النظام', authorId: 'system', cols, rows, cells,
    starts: starts.filter(x => x !== undefined), speed: 2.4, movement: 'ai', gateTime: 2, breakHp: 3, timeLimit: 180, updated, ...opts,
  };
}

function buildMazes() {
  return [
    mazeFromArt('maze1', 'سباق المتاهة', [
      '####################',
      '#12345678#.....?...#',
      '#........#.######..#',
      '#GGGGGGGG#.#....#..#',
      '#........#.#.?..#..#',
      '#...?....#.#....B..#',
      '#........#.###.##..#',
      '#..~~~~..#.........#',
      '#........#####.#####',
      '#..>>>>..........#.#',
      '###.######.#####.#.#',
      '#.....#....#.....#.#',
      '#.###.#.####.###.#.#',
      '#.#FF.#......#B..#.#',
      '#.#FF.#####..#.###.#',
      '#.#####...#..#.....#',
      '#.....B...#..#####.#',
      '#.###########.....>#',
      '#..................#',
      '####################',
    ], {}, 3),
    mazeFromArt('maze-spiral', 'الحلزون', [
      '####################',
      '#12345678..........#',
      '#..................#',
      '#GGGGGGGG########..#',
      '#...............#..#',
      '#...............#..#',
      '#..#########....#..#',
      '#..#.......#....#..#',
      '#..#.......#....#..#',
      '#..#..FF...#....#..#',
      '#..#..FF...B....#..#',
      '#..#.......#....#..#',
      '#..#########....#..#',
      '#..?............#..#',
      '#...............#..#',
      '#################..#',
      '#..................#',
      '#..>>>>>.....~~~~..#',
      '#..................#',
      '####################',
    ], { gateTime: 3, breakHp: 4 }, 4),
    mazeFromArt('maze-crusher', 'الكسّارة', [
      '####################',
      '#1.2.3.4.5.6.7.8...#',
      '#..................#',
      '#BBBBBBBBBBBBBBBBBB#',
      '#..................#',
      '#..?.........?.....#',
      '#..................#',
      '###BBBB####BBBB#####',
      '#..................#',
      '#......~~~~~~......#',
      '#..................#',
      '#BB####BBBBBB####BB#',
      '#..................#',
      '#...?..........?...#',
      '#..................#',
      '######BBBBBBBB######',
      '#..................#',
      '#.......FFFF.......#',
      '#.......FFFF.......#',
      '####################',
    ], { breakHp: 2, speed: 2.6 }, 5),
    mazeFromArt('maze-speedway', 'طريق السرعة', [
      '########################',
      '#1234....>>>>....~~~...#',
      '#5678....>>>>....~~~...#',
      '###################B...#',
      '#...~~~....>>>>........#',
      '#...~~~....>>>>....?...#',
      '#...B###################',
      '#......>>>>.....~~~....#',
      '#...?..>>>>.....~~~....#',
      '###################B...#',
      '#FF....~~~....>>>>.....#',
      '#FF....~~~....>>>>.....#',
      '########################',
    ], { speed: 2.3, breakHp: 8, gateTime: 0 }, 6),
    mazeFromArt('maze-gates', 'البوابات', [
      '###################',
      '#12.....?.?.....34#',
      '#.................#',
      '#..#####...#####..#',
      '#..#...........#..#',
      '#..#..GGGGGGG..#..#',
      '#.....G.....G.....#',
      '#..~..G.FFF.G..~..#',
      '#?....G.FFF.G....?#',
      '#..~..G.FFF.G..~..#',
      '#.....G.....G.....#',
      '#..#..GGGGGGG..#..#',
      '#..#...........#..#',
      '#..#####...#####..#',
      '#.................#',
      '#56.....?.?.....78#',
      '###################',
    ], { gateTime: 4, speed: 2.2 }, 7),
    mazeFromArt('maze-chaos', 'الفوضى', [
      '######################',
      '#1..2..3..4..5..6..7.#',
      '#8...................#',
      '#..#..#..#..#..#..#..#',
      '#....?.......?.......#',
      '#..B..B..B..B..B..B..#',
      '#....................#',
      '#.>>....~~~~....>>...#',
      '#..#..#..#..#..#..#..#',
      '#......?......?......#',
      '#..B..B..B..B..B..B..#',
      '#....................#',
      '#..#..#..#..#..#..#..#',
      '#....~~~......~~~....#',
      '#....................#',
      '##########BB##########',
      '#########.FF.#########',
      '######################',
    ], { speed: 2.4, breakHp: 3, timeLimit: 150 }, 8),
    mazeFromArt('maze-press', 'المكبس', [
      '####################',
      '#12345678....s.....#',
      '#.........f........#',
      '#################..#',
      '#.v...v...v...v....#',
      '#..................#',
      '#..................#',
      '#........g.........#',
      '#..#################',
      '#................FF#',
      '#.......b........FF#',
      '#..................#',
      '####^###^###^###^###',
      '####################',
    ], { speed: 2.4, pushRange: 3, pushSpeed: 1.3, timeLimit: 120 }, 9),
  ];
}

function addBuiltins() {
  for (const it of BUILTIN_ITEMS) store.items[it.id] = { ...it, icon: '', author: 'النظام', authorId: 'system', updated: 0 };
  for (const m of [buildClassicMap(), buildRainbowMap(), ...extraBreakout(), ...buildMazes(), ...extraMazes(mazeFromArt)]) store.maps[m.id] = m;
}

// ---------- validation ----------
const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const str = (v, max) => String(v ?? '').slice(0, max);

function cleanMap(o) {
  const cols = Math.round(num(o.cols, 8, 80, 0)), rows = Math.round(num(o.rows, 4, 80, 0));
  if (!Array.isArray(o.palette) || o.palette.length > 600 || !o.palette.every(c => HEX.test(c))) return 'palette غير صحيح';
  if (!Array.isArray(o.cells) || o.cells.length !== cols * rows) return 'حجم الخلايا غير صحيح';
  const max = o.palette.length + 1;
  if (!o.cells.every(v => Number.isInteger(v) && v >= 0 && v <= max)) return 'قيم الخلايا غير صحيحة';
  return {
    name: str(o.name, 40) || 'ماب بدون اسم', author: str(o.author, 24) || 'مجهول', authorId: str(o.authorId, 64),
    cols, rows, palette: o.palette, cells: o.cells,
    dropChance: num(o.dropChance, 0, 1, 0.1), ballSpeed: num(o.ballSpeed, 2, 12, 5), lives: Math.round(num(o.lives, 1, 9, 3)),
    paddleWidth: num(o.paddleWidth, 30, 300, 100),
    items: (Array.isArray(o.items) ? o.items : []).slice(0, 60).map(x => str(x, 64)),
  };
}

function cleanMaze(o) {
  const cols = Math.round(num(o.cols, 6, 60, 0)), rows = Math.round(num(o.rows, 6, 60, 0));
  if (!Array.isArray(o.cells) || o.cells.length !== cols * rows || !o.cells.every(v => Number.isInteger(v) && v >= 0 && v <= 15)) return 'خلايا المتاهة غير صحيحة';
  const starts = [...new Set((Array.isArray(o.starts) ? o.starts : []).filter(i => Number.isInteger(i) && i >= 0 && i < cols * rows))].slice(0, 8);
  if (!starts.length) return 'لازم نقطة بداية';
  if (!o.cells.includes(3)) return 'لازم خط نهاية';
  return {
    type: 'maze', name: str(o.name, 40) || 'متاهة', author: str(o.author, 24) || 'مجهول', authorId: str(o.authorId, 64),
    cols, rows, cells: o.cells, starts, speed: num(o.speed, 1, 6, 2.4), movement: ['player', 'ai'].includes(o.movement) ? o.movement : 'auto',
    gateTime: num(o.gateTime, 0, 30, 2), breakHp: Math.round(num(o.breakHp, 1, 20, 3)), timeLimit: num(o.timeLimit, 20, 600, 180),
    pushRange: Math.round(num(o.pushRange, 1, 12, 3)), pushSpeed: num(o.pushSpeed, 0.3, 4, 1), stopOnWin: !!o.stopOnWin,
  };
}

function cleanItem(o) {
  const icon = str(o.icon, 300000);
  if (icon && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(icon)) return 'الأيقونة لازم تكون صورة';
  return {
    name: str(o.name, 30) || 'أيتم', label: str(o.label, 4), color: HEX.test(o.color) ? o.color : '#19b5d8', icon,
    code: str(o.code, 20000), author: str(o.author, 24) || 'مجهول', authorId: str(o.authorId, 64),
  };
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
function readBody(req, limit) {
  return new Promise((ok, bad) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { bad(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', bad);
  });
}

async function handleApi(req, res, url) {
  const m = url.pathname.match(/^\/api\/(maps|items)(?:\/([\w-]+))?$/);
  if (!m) return json(res, 404, { error: 'not found' });
  const kind = m[1], coll = store[kind], id = m[2];
  if (req.method === 'GET') {
    if (id) return coll[id] ? json(res, 200, coll[id]) : json(res, 404, { error: 'غير موجود' });
    return json(res, 200, Object.values(coll).sort((a, b) => b.updated - a.updated));
  }
  if (req.method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req, 4e6)); } catch { return json(res, 400, { error: 'بيانات غير صحيحة' }); }
    const clean = kind === 'maps' ? (body.type === 'maze' ? cleanMaze(body) : cleanMap(body)) : cleanItem(body);
    if (typeof clean === 'string') return json(res, 400, { error: clean });
    let newId = body.id && coll[body.id] && coll[body.id].authorId === clean.authorId && clean.authorId !== 'system' ? body.id : null;
    if (!newId) newId = crypto.randomBytes(5).toString('hex');
    coll[newId] = { ...clean, id: newId, updated: Date.now() };
    persist(kind, newId);
    return json(res, 200, coll[newId]);
  }
  if (req.method === 'DELETE' && id) {
    const it = coll[id];
    if (!it) return json(res, 404, { error: 'غير موجود' });
    if (it.authorId === 'system' || it.authorId !== url.searchParams.get('authorId')) return json(res, 403, { error: 'مو لك' });
    delete coll[id]; persist(kind, id, true);
    return json(res, 200, { ok: true });
  }
  json(res, 405, { error: 'method' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url).catch(e => json(res, 500, { error: e.message }));
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const fp = path.join(PUB, p);
  if (!fp.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------- rooms ----------
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
const rooms = new Map();
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const broadcast = (room, m, except) => { for (const p of room.players.values()) if (p !== except) send(p, m); };

function roomInfo(room) {
  const map = store.maps[room.mapId];
  return {
    t: 'room', code: room.code, hostId: room.hostId, public: room.public, mapId: room.mapId, mapName: map ? map.name : '؟',
    mapType: map && map.type === 'maze' ? 'maze' : 'breakout', movement: room.movement || (map && map.movement) || 'auto',
    stopOnWin: room.stopOnWin ?? !!(map && map.stopOnWin),
    started: room.started, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, pick: p.pick ?? null })),
  };
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function leave(ws) {
  const room = ws.room; if (!room) return;
  room.players.delete(ws.id); ws.room = null;
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.hostId === ws.id) room.hostId = room.players.keys().next().value;
  broadcast(room, roomInfo(room));
  if (room.started) checkFinished(room);
}
function join(ws, room) {
  leave(ws);
  room.players.set(ws.id, ws); ws.room = room;
  broadcast(room, roomInfo(room));
}
function checkFinished(room) {
  const ids = [...room.players.keys()];
  if (ids.length && ids.every(id => room.results[id])) {
    room.started = false;
    const list = ids.map(id => ({ id, name: room.players.get(id).name, ...room.results[id] }))
      .sort((a, b) => (b.cleared - a.cleared) || ((a.place ?? 99) - (b.place ?? 99)) || (b.score - a.score) || (a.time - b.time));
    broadcast(room, { t: 'results', list });
    broadcast(room, roomInfo(room));
  }
}

wss.on('connection', ws => {
  ws.id = crypto.randomBytes(4).toString('hex');
  ws.name = 'لاعب'; ws.color = '#ff6b5a'; ws.pick = null;
  send(ws, { t: 'welcome', id: ws.id });
  ws.on('close', () => leave(ws));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try {
    const room = ws.room, isHost = room && room.hostId === ws.id;
    switch (m.t) {
      case 'hello':
        ws.name = str(m.name, 20) || 'لاعب'; ws.color = HEX.test(m.color) ? m.color : ws.color;
        if (room) broadcast(room, roomInfo(room));
        break;
      case 'lobbies':
        send(ws, { t: 'lobbies', list: [...rooms.values()].filter(r => r.public).map(r => ({ ...roomInfo(r), t: undefined })) });
        break;
      case 'create': {
        const r = { code: newCode(), hostId: ws.id, public: !!m.public, mapId: store.maps[m.mapId] ? m.mapId : 'classic', started: false, players: new Map(), results: {} };
        rooms.set(r.code, r); join(ws, r);
        break;
      }
      case 'join': {
        const r = rooms.get(str(m.code, 8).toUpperCase());
        if (!r) return send(ws, { t: 'error', msg: 'الغرفة مو موجودة' });
        if (r.started) return send(ws, { t: 'error', msg: 'اللعبة بدأت، استنى تخلص الجولة' });
        if (r.players.size >= 8) return send(ws, { t: 'error', msg: 'الغرفة مليانة' });
        join(ws, r);
        break;
      }
      case 'leave': leave(ws); send(ws, { t: 'left' }); break;
      case 'setMap':
        if (isHost && !room.started && store.maps[m.mapId]) { room.mapId = m.mapId; room.movement = null; room.stopOnWin = undefined; broadcast(room, roomInfo(room)); }
        break;
      case 'setMovement':
        if (isHost && !room.started) { room.movement = ['player', 'ai'].includes(m.movement) ? m.movement : 'auto'; broadcast(room, roomInfo(room)); }
        break;
      case 'setStopOnWin':
        if (isHost && !room.started) { room.stopOnWin = !!m.on; broadcast(room, roomInfo(room)); }
        break;
      case 'pick':
        if (room && !room.started) { ws.pick = Number.isInteger(m.i) && m.i >= 0 && m.i < 8 ? m.i : null; broadcast(room, roomInfo(room)); }
        break;
      case 'setPublic':
        if (isHost) { room.public = !!m.public; broadcast(room, roomInfo(room)); }
        break;
      case 'start': {
        if (!isHost || room.started) return;
        const map = store.maps[room.mapId]; if (!map) return;
        const items = {}; for (const id of map.items || []) if (store.items[id]) items[id] = store.items[id];
        room.started = true; room.results = {};
        const info = roomInfo(room);
        broadcast(room, { t: 'start', seed: Math.floor(Math.random() * 2 ** 31), map, items, players: info.players, movement: info.movement, stopOnWin: info.stopOnWin });
        broadcast(room, roomInfo(room));
        break;
      }
      case 'st': if (room && room.started) broadcast(room, { t: 'peer', id: ws.id, d: m.d }, ws); break;
      case 'fin':
        if (room && room.started && !room.results[ws.id]) {
          room.results[ws.id] = { score: num(m.score, 0, 1e9, 0), cleared: !!m.cleared, time: num(m.time, 0, 1e6, 0), place: num(m.place, 1, 99, null), pick: num(m.pick, 0, 7, null) };
          broadcast(room, { t: 'fin', id: ws.id, ...room.results[ws.id] });
          checkFinished(room);
        }
        break;
      case 'chat': if (room) broadcast(room, { t: 'chat', name: ws.name, msg: str(m.msg, 200) }); break;
    }
    } catch (e) { console.error("ws handler error:", e.message); }
  });
});

initStorage()
  .then(() => {
    addBuiltins();
    server.listen(PORT, () => console.log(`Block Arena running on http://localhost:${PORT}`));
  })
  .catch(e => { console.error("storage init failed:", e.message); process.exit(1); });
