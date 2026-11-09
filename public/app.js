import { Game, Mini, drawMapPreview, getImg, checkItemCode } from './game.js';
import { PixelEditor, fileToDataURL } from './pixel.js';
import { MapEditor } from './editor.js';
import { net } from './net.js';
import { $, $$, esc, api, toast, profile, saveProfile } from './store.js';

const state = { maps: [], items: {}, room: null, game: null, online: false, peers: {}, hudTimer: null };

// ================= navigation =================
const onShow = {};
function show(id) {
  if (id !== 'play') stopGame();
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  onShow[id]?.();
}
$$('nav button, [data-go]').forEach(b => b.onclick = () => show(b.dataset.screen || b.dataset.go));

// ================= data =================
async function loadItems() {
  const list = await api('items');
  state.items = Object.fromEntries(list.map(i => [i.id, i]));
  return state.items;
}
async function loadMaps() { state.maps = await api('maps'); return state.maps; }
const mine = o => o.authorId === profile.authorId;

// ================= game =================
function stopGame() {
  if (state.game) { state.game.destroyGame(); state.game = null; }
  clearInterval(state.hudTimer);
  $('#overlay').classList.add('hidden');
}

function startGame(map, items, { online = false, seed, players = [], back = 'sandbox' } = {}) {
  show('play');
  state.online = online; state.back = back;
  const pending = { k: [], set: [] };
  state.peers = {};
  const peersEl = $('#peers');
  peersEl.innerHTML = '';
  if (online) {
    for (const p of players) {
      if (p.id === net.id) continue;
      const el = document.createElement('div');
      el.className = 'peer';
      el.innerHTML = `<div><span class="dot" style="background:${esc(p.color)}"></span> <b>${esc(p.name)}</b></div><div class="pst">0</div><canvas></canvas>`;
      peersEl.append(el);
      state.peers[p.id] = { el, mini: new Mini($('canvas', el), map, p.color), name: p.name };
    }
  }
  const game = new Game($('#gameCanvas'), map, items, {
    seed, skin: profile,
    onToast: toast,
    onDestroy: i => pending.k.push(i),
    onCellSet: (i, v, col) => pending.set.push([i, v, col]),
    onEnd: res => {
      if (online) {
        net.send('fin', res);
        overlay(`<h2>${res.cleared ? '🏆 خلّصت الماب!' : '💀 انتهت أرواحك'}</h2><p>السكور: <b>${res.score}</b> · الوقت: ${res.time}ث</p><p class="sub">ننتظر باقي اللاعبين…</p>`);
      } else {
        overlay(`<h2>${res.cleared ? '🏆 فزت!' : '💀 خسرت'}</h2><p>السكور: <b>${res.score}</b> · الوقت: ${res.time}ث</p>
          <div class="row2" style="justify-content:center"><button class="primary" id="ovRetry">🔁 مرة ثانية</button><button id="ovBack">رجوع</button></div>`);
        $('#ovRetry').onclick = () => startGame(map, items, { back });
        $('#ovBack').onclick = () => show(back);
      }
    },
  });
  state.game = game;
  let tick = 0;
  state.hudTimer = setInterval(() => {
    $('#hudScore').textContent = '⭐ ' + game.score;
    $('#hudLives').textContent = '❤'.repeat(Math.max(0, game.lives));
    $('#hudLeft').textContent = '🟥 ' + game.remaining;
    if (online) {
      const d = { ...game.snapshot(), k: pending.k.splice(0), set: pending.set.splice(0) };
      net.send('st', { d });
      if (++tick % 2 === 0) for (const p of Object.values(state.peers)) p.mini.render();
    }
  }, 100);
}

function overlay(html) {
  $('#overlayBox').innerHTML = html;
  $('#overlay').classList.remove('hidden');
}

$('#exitGame').onclick = () => {
  if (state.online && state.game && !state.game.over) {
    if (!confirm('تطلع من التحدي؟ بتنحسب منسحب.')) return;
    net.send('fin', { score: state.game.score, cleared: false, time: 9999 });
  }
  show(state.online && state.room ? 'room' : state.back || 'sandbox');
};

// ================= sandbox =================
onShow.sandbox = async () => {
  await Promise.all([loadMaps(), loadItems()]);
  renderMapGrid();
};
$('#mapSearch').oninput = () => renderMapGrid();
function renderMapGrid() {
  const q = $('#mapSearch').value.trim().toLowerCase();
  const grid = $('#mapGrid');
  grid.innerHTML = '';
  for (const m of state.maps.filter(m => !q || (m.name + m.author).toLowerCase().includes(q))) {
    const el = document.createElement('div');
    el.className = 'map-card';
    el.innerHTML = `<canvas></canvas><div><b>${esc(m.name)}</b><div class="sub">✍ ${esc(m.author)} · ${m.cols}×${m.rows} · ${m.items.length} أيتم</div></div>
      <div class="acts"><button class="primary" data-a="solo">▶ سولو</button><button data-a="priv">🔒 تحدي</button><button data-a="pub">🌍 لوبي</button><button data-a="edit">✏ ${mine(m) ? 'تعديل' : 'نسخة'}</button>${mine(m) ? '<button data-a="del">🗑</button>' : ''}</div>`;
    drawMapPreview($('canvas', el), m, 4);
    el.querySelector('[data-a=solo]').onclick = () => startGame(m, state.items);
    el.querySelector('[data-a=priv]').onclick = () => createRoom(false, m.id);
    el.querySelector('[data-a=pub]').onclick = () => createRoom(true, m.id);
    el.querySelector('[data-a=edit]').onclick = () => {
      const copy = structuredClone(m);
      if (!mine(m)) { delete copy.id; copy.name += ' (نسخة)'; }
      show('editor'); editor.load(copy);
    };
    el.querySelector('[data-a=del]')?.addEventListener('click', async () => {
      if (!confirm(`تحذف "${m.name}"؟`)) return;
      await api(`maps/${m.id}?authorId=${encodeURIComponent(profile.authorId)}`, null, 'DELETE');
      onShow.sandbox();
    });
    grid.append(el);
  }
}

// ================= editor =================
let editorLoaded = false;
const editor = new MapEditor($('#editorRoot'), {
  getItems: () => state.items,
  onTest: map => startGame(map, state.items, { back: 'editor' }),
  onSave: async map => {
    try {
      const saved = await api('maps', { ...map, author: profile.name, authorId: profile.authorId });
      editor.map.id = saved.id;
      toast('✅ انرفع للساندبوكس');
    } catch (e) { toast('❌ ' + e.message); }
  },
});
onShow.editor = async () => {
  await loadItems();
  if (!editorLoaded) { editorLoaded = true; }
  editor.refreshItems();
};

// ================= items lab =================
const API_DOC = `// 🔒 الكود يشتغل في بيئة معزولة (Web Worker): ما يقدر يوصل للصفحة
// ولا للإنترنت ولا للتخزين. لو علّق أكثر من 0.4 ثانية يتوقف الأيتم.
// المتغيرات نسخة للقراءة — للتعديل استخدم الأوامر (مثل api.setBall).

// متغيرات:
api.balls        // مصفوفة الكور [{x, y, vx, vy, r}]
api.paddle       // {x, y, w, h, color}
api.score, api.lives, api.remaining, api.time
api.cols, api.rows, api.cellSize, api.width, api.height
api.random()     // رقم عشوائي 0..1

// أوامر:
api.multiplyBalls(3)          // كل كورة تطلع منها 3
api.spawnBalls(2)             // كور جديدة من المضرب
api.scalePaddle(1.5, 10000)   // تكبير المضرب (مدة ms)
api.ballSpeed(0.6, 8000)      // سرعة الكور
api.pierce(6000)              // الكورة تخترق البلوكات
api.laser(7000)               // المضرب يطلق ليزر
api.shield(10000)             // درع تحت
api.addLife(1)  api.addScore(50)
api.explode(x, y, radius)     // تفجير
api.destroyRandom(10)         // كسر بلوكات عشوائية
api.destroyColor('#c94a4a')   // كسر كل لون
api.destroyAt(col, row)
api.cellAt(col, row)          // 'empty' | 'wall' | '#hex'
api.setCell(col, row, 'wall' | '#ff0000' | 0)
api.setPaddleColor('#00ff00', 5000)
api.setBall(0, { vx: 0, vy: -6 })  // تعديل كورة
api.after(ms, () => {...})    // بعد وقت
api.every(ms, () => {...}, times)
api.toast('رسالة')

// مثال: مطر بلوكات ذهبية
api.every(200, () => {
  const c = Math.floor(api.random() * api.cols);
  api.setCell(c, 1, '#ffd700');
}, 20);`;
$('#apiDoc').textContent = API_DOC;

let curItem = null;
const pix = new PixelEditor($('#itPix'), { w: 16, h: 16, scale: 14, onChange: () => updateItemPreview() });
function newItem() {
  return { name: 'أيتم جديد', label: '★', color: '#19b5d8', icon: '', code: '// اكتب السلوك هنا\napi.multiplyBalls(2);\napi.toast("⭐");' };
}
function editItem(it) {
  curItem = it;
  $('#itName').value = it.name; $('#itLabel').value = it.label; $('#itColor').value = it.color; $('#itCode').value = it.code;
  pix.load(it.icon).then(updateItemPreview);
  $('#itDelete').disabled = !it.id || !mine(it);
  $('#itHint').textContent = it.id && !mine(it) ? 'هذا الأيتم مو لك — الحفظ بيسوي نسخة جديدة باسمك.' : '';
  renderItemList();
}
function collectItem() {
  return { ...curItem, name: $('#itName').value.trim(), label: $('#itLabel').value.trim(), color: $('#itColor').value, code: $('#itCode').value, icon: pix.toDataURL() };
}
function updateItemPreview() {
  const icon = pix.toDataURL(), el = $('#itPreview');
  el.style.background = $('#itColor').value;
  el.innerHTML = icon ? `<img src="${icon}">` : esc($('#itLabel').value);
}
['#itLabel', '#itColor'].forEach(s => $(s).oninput = updateItemPreview);
function renderItemList() {
  $('#itList').innerHTML = '';
  for (const it of Object.values(state.items)) {
    const el = document.createElement('div');
    el.className = 'li' + (curItem?.id === it.id ? ' sel' : '');
    el.innerHTML = `<span class="ico" style="background:${esc(it.color)}">${it.icon ? `<img src="${esc(it.icon)}">` : esc(it.label)}</span><div class="grow"><b>${esc(it.name)}</b><div class="sub">${esc(it.author)}</div></div>`;
    el.onclick = () => editItem(structuredClone(it));
    $('#itList').append(el);
  }
}
onShow.items = async () => { await loadItems(); if (!curItem) editItem(newItem()); else renderItemList(); };
$('#itNew').onclick = () => editItem(newItem());
$('#itUpload').onchange = async e => { const f = e.target.files[0]; if (f) await pix.load(await fileToDataURL(f, 16, 16)); updateItemPreview(); e.target.value = ''; };
$('#itTest').onclick = async () => {
  const it = { ...collectItem(), id: '__test' };
  try { checkItemCode(it.code); } catch (e) { return toast('❌ خطأ في الكود: ' + e.message); }
  if (!state.maps.length) await loadMaps();
  const base = state.maps.find(m => m.id === 'classic') || state.maps[0];
  const map = { ...base, items: ['__test'], dropChance: 0.25 };
  startGame(map, { __test: it }, { back: 'items' });
  toast('الأيتم بينزل كثير عشان تجربه');
};
$('#itSave').onclick = async () => {
  const it = collectItem();
  try { checkItemCode(it.code); } catch (e) { return toast('❌ خطأ في الكود: ' + e.message); }
  try {
    const saved = await api('items', { ...it, author: profile.name, authorId: profile.authorId });
    await loadItems(); editItem(structuredClone(saved));
    toast('✅ انحفظ — تقدر تضيفه لأي ماب من صانع المابات');
  } catch (e) { toast('❌ ' + e.message); }
};
$('#itDelete').onclick = async () => {
  if (!curItem?.id || !confirm('تحذف الأيتم؟')) return;
  await api(`items/${curItem.id}?authorId=${encodeURIComponent(profile.authorId)}`, null, 'DELETE');
  await loadItems(); editItem(newItem());
};

// ================= profile / paddle =================
const pfPix = new PixelEditor($('#pfPix'), { w: 32, h: 6, scale: 12, onChange: () => renderPaddlePreview() });
function renderPaddlePreview() {
  const cv = $('#pfPreview'), c = cv.getContext('2d');
  c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, cv.width, cv.height);
  const x = 60, y = 40, w = 200, h = 18;
  c.fillStyle = $('#pfColor').value; c.fillRect(x, y, w, h);
  const tex = pfPix.toDataURL();
  if (tex) { const img = new Image(); img.onload = () => { c.imageSmoothingEnabled = false; c.drawImage(img, x, y, w, h); }; img.src = tex; }
  c.fillStyle = '#fff'; c.beginPath(); c.arc(160, 26, 6, 0, 7); c.fill();
}
onShow.profile = () => {
  $('#pfName').value = profile.name; $('#pfColor').value = profile.color;
  pfPix.load(profile.texture).then(renderPaddlePreview);
};
$('#pfColor').oninput = renderPaddlePreview;
$('#pfUpload').onchange = async e => { const f = e.target.files[0]; if (f) await pfPix.load(await fileToDataURL(f, 32, 6)); renderPaddlePreview(); e.target.value = ''; };
$('#pfSave').onclick = () => {
  profile.name = $('#pfName').value.trim() || profile.name;
  profile.color = $('#pfColor').value;
  profile.texture = pfPix.toDataURL();
  saveProfile(); net.hello(); toast('✅ انحفظ');
};

// ================= online: lobby & rooms =================
let lobbyTimer;
onShow.home = () => { net.send('lobbies'); clearInterval(lobbyTimer); lobbyTimer = setInterval(() => { if ($('#home').classList.contains('active')) net.send('lobbies'); }, 3000); };
function createRoom(isPublic, mapId) {
  if (!net.ready) return toast('مو متصل بالسيرفر');
  net.send('create', { public: isPublic, mapId });
}
$('#createPrivate').onclick = () => createRoom(false);
$('#createPublic').onclick = () => createRoom(true);
$('#joinBtn').onclick = () => net.send('join', { code: $('#joinCode').value.trim() });
$('#leaveBtn').onclick = () => { net.send('leave'); state.room = null; show('home'); };
$('#copyInvite').onclick = async () => {
  const link = `${location.origin}/?room=${state.room.code}`;
  try { await navigator.clipboard.writeText(link); toast('🔗 انسخ الرابط: ' + link); } catch { prompt('انسخ الرابط:', link); }
};
$('#roomPublic').onchange = e => net.send('setPublic', { public: e.target.checked });
$('#roomMap').onchange = e => net.send('setMap', { mapId: e.target.value });
$('#startBtn').onclick = () => net.send('start');
$('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (v) net.send('chat', { msg: v }); $('#chatIn').value = ''; };

net.on('open', () => {
  $('#netStatus').textContent = '🟢 متصل';
  const code = new URLSearchParams(location.search).get('room');
  if (code) { net.send('join', { code }); history.replaceState(null, '', '/'); }
  if ($('#home').classList.contains('active')) net.send('lobbies');
});
net.on('close', () => { $('#netStatus').textContent = '🔴 انقطع الاتصال…'; state.room = null; });
net.on('error', m => toast('⚠ ' + m.msg));
net.on('lobbies', m => {
  const el = $('#lobbyList');
  if (!m.list.length) { el.innerHTML = '<div class="sub">ما فيه لوبيات الحين… سوّ واحد!</div>'; return; }
  el.innerHTML = '';
  for (const r of m.list) {
    const li = document.createElement('div');
    li.className = 'li';
    li.innerHTML = `<div class="grow"><b>${esc(r.players[0]?.name || '')}</b> · ${esc(r.mapName)}<div class="sub">${r.players.length}/8 لاعبين ${r.started ? '· 🎮 يلعبون' : ''}</div></div><button ${r.started ? 'disabled' : ''}>انضم</button>`;
    li.querySelector('button').onclick = () => net.send('join', { code: r.code });
    el.append(li);
  }
});
net.on('room', async m => {
  const first = !state.room || state.room.code !== m.code;
  state.room = m;
  if (first) { $('#chatLog').innerHTML = ''; if (!$('#play').classList.contains('active')) show('room'); }
  if (!state.maps.length) await loadMaps();
  const isHost = m.hostId === net.id;
  $('#roomCode').textContent = m.code;
  $('#roomPublic').checked = m.public; $('#roomPublic').disabled = !isHost;
  const sel = $('#roomMap');
  sel.innerHTML = state.maps.map(mp => `<option value="${esc(mp.id)}" ${mp.id === m.mapId ? 'selected' : ''}>${esc(mp.name)} — ${esc(mp.author)}</option>`).join('');
  sel.disabled = !isHost || m.started;
  $('#startBtn').disabled = !isHost || m.started;
  $('#roomHint').textContent = isHost ? 'انت الهوست: اختار الماب وابدأ متى ما جهزتوا.' : 'ننتظر الهوست يبدأ…';
  $('#roomPlayers').innerHTML = m.players.map(p => `<div class="li"><span class="dot" style="background:${esc(p.color)}"></span><div class="grow">${esc(p.name)}${p.id === net.id ? ' (انت)' : ''}</div>${p.id === m.hostId ? '👑' : ''}</div>`).join('');
});
net.on('left', () => { state.room = null; });
net.on('chat', m => {
  const log = $('#chatLog');
  log.insertAdjacentHTML('beforeend', `<div><b>${esc(m.name)}:</b> ${esc(m.msg)}</div>`);
  log.scrollTop = log.scrollHeight;
});
net.on('start', m => {
  const hasCode = Object.values(m.items).some(it => !['multi3', 'wide', 'slow', 'fire', 'laser', 'shield', 'life', 'bomb'].includes(it.id));
  startGame(m.map, m.items, { online: true, seed: m.seed, players: m.players });
  if (hasCode) toast('ℹ الماب فيه أيتمز بكود مخصص (يشتغل في بيئة معزولة)');
});
net.on('peer', m => {
  const p = state.peers[m.id]; if (!p) return;
  p.mini.apply(m.d);
  $('.pst', p.el).textContent = `⭐ ${m.d.s} · ❤ ${m.d.l} · 🟥 ${m.d.r}`;
});
net.on('fin', m => {
  const p = state.peers[m.id]; if (!p) return;
  p.el.classList.add('done');
  $('.pst', p.el).textContent = `${m.cleared ? '🏆 خلّص' : '💀 انتهى'} · ⭐ ${m.score}`;
});
net.on('results', m => {
  if (!$('#play').classList.contains('active')) return;
  const medals = ['🥇', '🥈', '🥉'];
  overlay(`<h2>🏁 النتائج</h2><table>${m.list.map((r, i) => `<tr><td>${medals[i] || i + 1}</td><td>${esc(r.name)}${r.id === net.id ? ' (انت)' : ''}</td><td>${r.cleared ? '🏆' : '💀'}</td><td>⭐ ${r.score}</td><td>${r.time >= 9999 ? 'انسحب' : r.time + 'ث'}</td></tr>`).join('')}</table>
    <button class="primary" id="ovRoom">↩ رجوع للغرفة</button>`);
  $('#ovRoom').onclick = () => show('room');
});

// ================= boot =================
window.BA = state; // handy for debugging in the console
net.connect();
show('home');
loadItems(); loadMaps();
