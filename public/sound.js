// Synthesized sound effects (Web Audio) - no audio files needed.
let ctx = null, master = null;
let muted = false, volume = 0.6;
try {
  muted = localStorage.getItem('ba_muted') === '1';
  const v = parseFloat(localStorage.getItem('ba_volume'));
  if (Number.isFinite(v)) volume = v;
} catch {}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// Browsers only allow audio after a user gesture.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => ac(), { passive: true });

export const isMuted = () => muted;
export const getVolume = () => volume;
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('ba_muted', muted ? '1' : '0'); } catch {}
  if (master) master.gain.value = muted ? 0 : volume;
}
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  try { localStorage.setItem('ba_volume', String(volume)); } catch {}
  if (master && !muted) master.gain.value = volume;
}

function tone({ f = 440, f2 = null, type = 'square', dur = 0.08, vol = 0.15, delay = 0, attack = 0.004 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise({ dur = 0.2, vol = 0.3, freq = 800, q = 0.8, delay = 0 }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, freq / 6), t + dur); f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}

const notes = (base, steps, opts) => steps.forEach((s, i) => tone({ f: base * 2 ** (s / 12), delay: i * (opts.gap ?? 0.09), ...opts }));

const SOUNDS = {
  // combo raises the pitch for chains of blocks without touching the paddle
  brick: (combo = 0) => tone({ f: 520 * 2 ** (Math.min(combo, 24) / 12), type: 'square', dur: 0.06, vol: 0.09 }),
  wall: () => tone({ f: 180, type: 'triangle', dur: 0.05, vol: 0.12 }),
  edge: () => tone({ f: 260, type: 'triangle', dur: 0.03, vol: 0.05 }),
  paddle: () => tone({ f: 330, f2: 440, type: 'square', dur: 0.07, vol: 0.12 }),
  launch: () => tone({ f: 300, f2: 900, type: 'sawtooth', dur: 0.15, vol: 0.08 }),
  item: () => notes(660, [0, 4, 7, 12], { type: 'square', dur: 0.08, vol: 0.09, gap: 0.05 }),
  life: () => notes(523, [0, 7, 12, 16], { type: 'triangle', dur: 0.14, vol: 0.18, gap: 0.08 }),
  lose_life: () => tone({ f: 440, f2: 80, type: 'sawtooth', dur: 0.45, vol: 0.12 }),
  laser: () => tone({ f: 1400, f2: 300, type: 'square', dur: 0.08, vol: 0.05 }),
  boom: () => { noise({ dur: 0.45, vol: 0.5, freq: 900 }); tone({ f: 120, f2: 40, type: 'sine', dur: 0.4, vol: 0.3 }); },
  win: () => notes(523, [0, 4, 7, 12, 7, 12, 16], { type: 'square', dur: 0.14, vol: 0.1, gap: 0.11 }),
  gameover: () => notes(392, [0, -2, -4, -7], { type: 'triangle', dur: 0.3, vol: 0.15, gap: 0.22 }),
  start: () => notes(440, [0, 0, 12], { type: 'square', dur: 0.12, vol: 0.1, gap: 0.25 }),
  chat: () => tone({ f: 880, f2: 1320, type: 'sine', dur: 0.09, vol: 0.1 }),
  coin: () => { tone({ f: 988, type: 'square', dur: 0.06, vol: 0.08 }); tone({ f: 1319, type: 'square', dur: 0.2, vol: 0.08, delay: 0.06 }); },
  powerdown: () => tone({ f: 800, f2: 150, type: 'square', dur: 0.35, vol: 0.08 }),
  zap: () => tone({ f: 2000, f2: 100, type: 'sawtooth', dur: 0.2, vol: 0.07 }),
};
export const SOUND_NAMES = Object.keys(SOUNDS);

// Limits so 200 balls don't melt anyone's ears.
const MIN_GAP = { brick: 0.035, wall: 0.05, edge: 0.07, paddle: 0.04, laser: 0.08, boom: 0.12, item: 0.08 };
const last = {};
let windowStart = 0, inWindow = 0;

export function play(name, arg) {
  if (muted || !SOUNDS[name] || !ac() || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - (last[name] ?? -1) < (MIN_GAP[name] ?? 0.03)) return;
  if (now - windowStart > 0.1) { windowStart = now; inWindow = 0; }
  if (++inWindow > 10) return;
  last[name] = now;
  SOUNDS[name](arg);
}

const WAVES = ['sine', 'square', 'triangle', 'sawtooth'];
// Custom tone for item code: frequency in Hz, duration in ms.
export function playTone(freq, ms = 120, type = 'square') {
  if (muted || !ac() || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - windowStart > 0.1) { windowStart = now; inWindow = 0; }
  if (++inWindow > 10) return;
  tone({ f: Math.max(40, Math.min(4000, Number(freq) || 440)), dur: Math.max(0.02, Math.min(2, (Number(ms) || 120) / 1000)), type: WAVES.includes(type) ? type : 'square', vol: 0.1 });
}
