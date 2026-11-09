export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadProfile() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('ba_profile') || '{}'); } catch {}
  return {
    name: p.name || 'لاعب' + Math.floor(Math.random() * 900 + 100),
    color: p.color || '#ff6b5a',
    texture: p.texture || '',
    authorId: p.authorId || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
  };
}
export const profile = loadProfile();
export function saveProfile() {
  try { localStorage.setItem('ba_profile', JSON.stringify(profile)); } catch {}
}
saveProfile();

export async function api(path, body, method) {
  const res = await fetch('/api/' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطأ');
  return data;
}

let toastTimer;
export function toast(msg) {
  if (!msg) return;
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
