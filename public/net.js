import { profile } from './store.js';

const listeners = {};
const emit = (t, m) => (listeners[t] || []).forEach(f => f(m));

export const net = {
  id: null, ws: null,
  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    this.ws = ws;
    ws.onopen = () => { this.hello(); emit('open'); };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') this.id = m.id;
      emit(m.t, m);
    };
    ws.onclose = () => { emit('close'); setTimeout(() => this.connect(), 2000); };
  },
  get ready() { return this.ws?.readyState === 1; },
  hello() { this.send('hello', { name: profile.name, color: profile.color }); },
  send(t, d = {}) { if (this.ready) this.ws.send(JSON.stringify({ t, ...d })); },
  on(t, fn) { (listeners[t] ||= []).push(fn); },
};
