// Runs user item code in an isolated Web Worker.
// - No DOM, no localStorage, no cookies (workers never have them).
// - Network / storage / sub-worker globals are wiped before any user code runs.
// - The host terminates this worker if a run takes too long (infinite loops).
// User code only sees a snapshot of the game and queues commands; the host validates and applies them.
'use strict';

const post = self.postMessage.bind(self);
const MAX_CMDS = 500;
const fns = {};
const compileErrors = {};
const callbacks = new Map();
let nextTid = 0;
let cur = { snap: null, cmds: [] };

const cmd = (...a) => { if (cur.cmds.length < MAX_CMDS) cur.cmds.push(a); };

const api = {
  get balls() { return cur.snap.balls; },
  get paddle() { return cur.snap.paddle; },
  get score() { return cur.snap.score; },
  get lives() { return cur.snap.lives; },
  get remaining() { return cur.snap.remaining; },
  get time() { return cur.snap.time; },
  get cols() { return cur.snap.cols; },
  get rows() { return cur.snap.rows; },
  get cellSize() { return cur.snap.cellSize; },
  get width() { return cur.snap.width; },
  get height() { return cur.snap.height; },
  random: () => Math.random(),
  after(ms, fn) {
    if (typeof fn !== 'function') return;
    const tid = ++nextTid;
    callbacks.set(tid, fn);
    cmd('after', tid, Number(ms) || 0);
  },
  every(ms, fn, times = Infinity) {
    let n = 0;
    const tick = () => { fn(); if (++n < times) api.after(ms, tick); };
    api.after(ms, tick);
  },
  cellAt(c, r) {
    const s = cur.snap;
    if (!(c >= 0 && r >= 0 && c < s.cols && r < s.rows)) return null;
    const v = s.cells[(r | 0) * s.cols + (c | 0)];
    return v === 0 ? 'empty' : v === 1 ? 'wall' : s.palette[v - 2];
  },
  setCell(c, r, value) {
    const s = cur.snap;
    if (c >= 0 && r >= 0 && c < s.cols && r < s.rows) {
      let v = 0;
      if (value === 'wall') v = 1;
      else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
        let k = s.palette.indexOf(value);
        if (k < 0) { s.palette.push(value); k = s.palette.length - 1; }
        v = k + 2;
      }
      s.cells[(r | 0) * s.cols + (c | 0)] = v;
    }
    cmd('setCell', c, r, value);
  },
  setBall(i, props) {
    const b = cur.snap.balls[i];
    if (!b || !props) return;
    const clean = {};
    for (const k of ['x', 'y', 'vx', 'vy']) if (Number.isFinite(props[k])) { clean[k] = props[k]; b[k] = props[k]; }
    cmd('setBall', i, clean);
  },
};
for (const name of ['multiplyBalls', 'spawnBalls', 'scalePaddle', 'ballSpeed', 'pierce', 'shield', 'laser', 'setPaddleColor',
  'destroyAt', 'explode', 'destroyRandom', 'destroyColor', 'addScore', 'addLife', 'toast']) {
  api[name] = (...args) => cmd(name, ...args.map(a => (typeof a === 'string' ? a.slice(0, 120) : a)));
}
Object.freeze(api);

self.onmessage = e => {
  const m = e.data;
  if (m.t === 'init') {
    for (const [id, code] of Object.entries(m.codes)) {
      try { fns[id] = new Function('api', '"use strict";\n' + (code || '')); }
      catch (err) { compileErrors[id] = String(err && err.message || err); }
    }
    post({ t: 'ready' });
    return;
  }
  if (m.t === 'run') {
    cur = { snap: m.snap, cmds: [] };
    let err = null;
    try {
      if (m.tid) {
        const fn = callbacks.get(m.tid);
        callbacks.delete(m.tid);
        if (fn) fn();
      } else if (compileErrors[m.id]) {
        err = compileErrors[m.id];
      } else if (fns[m.id]) {
        fns[m.id](api);
      }
    } catch (ex) { err = String(ex && ex.message || ex); }
    post({ t: 'done', rid: m.rid, cmds: cur.cmds, err });
  }
};

// Wipe capabilities that user code must not have (network, storage, nested workers, messaging).
const BLOCK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches',
  'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator', 'location', 'postMessage', 'close', 'cookieStore',
  'Request', 'Response', 'Headers', 'FileReaderSync', 'RTCPeerConnection', 'RTCDataChannel', 'MessageChannel', 'onmessage', 'addEventListener'];
for (const k of BLOCK) {
  if (k === 'onmessage') continue; // keep our own handler (set above) working
  let o = self;
  while (o) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch {}
    }
    o = Object.getPrototypeOf(o);
  }
}
try { Object.defineProperty(self, 'onmessage', { value: self.onmessage, writable: false, configurable: false }); } catch {}
