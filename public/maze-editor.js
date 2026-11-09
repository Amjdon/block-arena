// Separate editor for Maze Race maps.
import { T, TILE_INFO, RACER_COLORS, drawMazePreview } from './maze.js';
import { $, $$, toast } from './store.js';

const S = 22; // editor pixels per cell
const START_TOOL = 'start';

export function blankMaze(cols = 20, rows = 20) {
  const cells = new Array(cols * rows).fill(T.FLOOR);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!r || !c || r === rows - 1 || c === cols - 1) cells[r * cols + c] = T.WALL;
  const starts = [1, 2, 3, 4].map(k => cols + k);
  cells[(rows - 2) * cols + cols - 2] = T.FINISH;
  return { type: 'maze', name: 'متاهة جديدة', cols, rows, cells, starts, speed: 2.4, movement: 'auto', gateTime: 2, breakHp: 3, timeLimit: 180 };
}

export class MazeEditor {
  constructor(root, { onTest, onSave }) {
    this.root = root; this.onTest = onTest; this.onSave = onSave;
    this.tile = T.WALL; this.shape = 'pen'; this.undo = [];
    root.innerHTML = `
      <div class="ed-bar">
        <div class="group" id="mzTiles">
          ${TILE_INFO.map((t, i) => `<button data-tile="${i}" title="${t.name}">${t.icon} ${t.name}</button>`).join('')}
          <button data-tile="${START_TOOL}" title="نقطة بداية (حتى 8)">🚩 بداية</button>
        </div>
        <div class="group">
          <button data-shape="pen" class="on">✏ رسم</button>
          <button data-shape="rect">▭ مستطيل</button>
          <button data-shape="fill">🪣 تعبئة</button>
        </div>
        <div class="group">
          <button id="mzUndo">↶ تراجع</button>
          <button id="mzNew">📄 جديد</button>
          <button id="mzExport">⬇ JSON</button>
          <label class="btn">⬆ JSON<input type="file" accept=".json" id="mzImport" hidden></label>
        </div>
      </div>
      <div class="ed-main">
        <div class="ed-canvas-wrap" dir="ltr"><canvas id="mzCanvas"></canvas></div>
        <div class="ed-side card">
          <label>اسم المتاهة <input id="mzName" maxlength="40"></label>
          <div class="row2">
            <label>عرض <input type="number" id="mzCols" min="6" max="60"></label>
            <label>طول <input type="number" id="mzRows" min="6" max="60"></label>
            <button id="mzResize">تطبيق</button>
          </div>
          <label>طريقة الحركة الافتراضية
            <select id="mzMove"><option value="auto">🤖 تلقائي (المربعات ترتد لحالها)</option><option value="player">🎮 تحكم (كل لاعب يحرك مربعه)</option></select>
          </label>
          <label>السرعة <span id="mzSpeedV"></span><input type="range" id="mzSpeed" min="1" max="6" step="0.2"></label>
          <div class="row2">
            <label>البوابات تفتح بعد (ث) <input type="number" id="mzGate" min="0" max="30" step="0.5"></label>
            <label>قوة البلوك <input type="number" id="mzHp" min="1" max="20"></label>
          </div>
          <label>الوقت الأقصى (ث) <input type="number" id="mzLimit" min="20" max="600"></label>
          <div class="sub">🚩 نقاط البداية: اختار "بداية" واضغط على الخانة (اضغط مرة ثانية للحذف). الترتيب = لون المربع.</div>
          <div class="stats" id="mzStats"></div>
          <div class="row2">
            <button class="primary" id="mzTest">▶ جرّب</button>
            <button class="primary" id="mzSave">☁ ارفع للساندبوكس</button>
          </div>
        </div>
      </div>`;
    this.cv = $('#mzCanvas', root);
    $$('[data-tile]', root).forEach(b => b.onclick = () => {
      this.tile = b.dataset.tile === START_TOOL ? START_TOOL : +b.dataset.tile;
      $$('[data-tile]', root).forEach(x => x.classList.toggle('on', x === b));
    });
    $(`[data-tile="${T.WALL}"]`, root).classList.add('on');
    $$('[data-shape]', root).forEach(b => b.onclick = () => {
      this.shape = b.dataset.shape;
      $$('[data-shape]', root).forEach(x => x.classList.toggle('on', x === b));
    });
    $('#mzUndo', root).onclick = () => this.doUndo();
    $('#mzNew', root).onclick = () => { if (confirm('تبدأ متاهة جديدة؟')) this.load(blankMaze()); };
    $('#mzResize', root).onclick = () => this.resize(+$('#mzCols', root).value, +$('#mzRows', root).value);
    $('#mzSpeed', root).oninput = () => { $('#mzSpeedV', root).textContent = $('#mzSpeed', root).value; };
    $('#mzExport', root).onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(this.collect())], { type: 'application/json' }));
      a.download = (this.map.name || 'maze') + '.json'; a.click();
    };
    $('#mzImport', root).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const m = JSON.parse(await f.text()); if (m.type !== 'maze') throw 0; delete m.id; this.load(m); } catch { toast('ملف متاهة غير صحيح'); }
      e.target.value = '';
    };
    $('#mzTest', root).onclick = () => { const m = this.collect(); if (this.check(m)) this.onTest(m); };
    $('#mzSave', root).onclick = () => { const m = this.collect(); if (this.check(m)) this.onSave(m); };
    document.addEventListener('keydown', e => {
      if (root.offsetParent && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.doUndo(); }
    });
    this.bindCanvas();
    this.load(blankMaze());
  }

  load(map) {
    this.map = { ...blankMaze(map.cols, map.rows), ...map, cells: [...map.cells], starts: [...(map.starts || [])] };
    this.undo = [];
    const r = this.root;
    $('#mzName', r).value = this.map.name;
    $('#mzCols', r).value = this.map.cols; $('#mzRows', r).value = this.map.rows;
    $('#mzMove', r).value = this.map.movement;
    $('#mzSpeed', r).value = this.map.speed; $('#mzSpeedV', r).textContent = this.map.speed;
    $('#mzGate', r).value = this.map.gateTime; $('#mzHp', r).value = this.map.breakHp; $('#mzLimit', r).value = this.map.timeLimit;
    this.render();
  }

  collect() {
    const r = this.root, m = this.map;
    m.name = $('#mzName', r).value.trim() || 'متاهة';
    m.movement = $('#mzMove', r).value;
    m.speed = +$('#mzSpeed', r).value;
    m.gateTime = +$('#mzGate', r).value || 0;
    m.breakHp = +$('#mzHp', r).value || 3;
    m.timeLimit = +$('#mzLimit', r).value || 180;
    m.starts = m.starts.filter(i => i < m.cells.length && m.cells[i] !== T.WALL);
    return { ...m, type: 'maze', cells: [...m.cells], starts: [...m.starts] };
  }

  check(m) {
    if (!m.starts.length) { toast('⚠ حط نقطة بداية وحدة على الأقل 🚩'); return false; }
    if (!m.cells.includes(T.FINISH)) { toast('⚠ حط خط النهاية 🏁'); return false; }
    return true;
  }

  resize(cols, rows) {
    cols = Math.max(6, Math.min(60, cols | 0)); rows = Math.max(6, Math.min(60, rows | 0));
    this.pushUndo();
    const m = this.map, cells = new Array(cols * rows).fill(T.FLOOR);
    for (let r = 0; r < Math.min(rows, m.rows); r++) for (let c = 0; c < Math.min(cols, m.cols); c++) cells[r * cols + c] = m.cells[r * m.cols + c];
    m.starts = m.starts.map(i => ({ c: i % m.cols, r: Math.floor(i / m.cols) })).filter(p => p.c < cols && p.r < rows).map(p => p.r * cols + p.c);
    Object.assign(m, { cols, rows, cells });
    this.render();
  }

  pushUndo() { this.undo.push({ cells: this.map.cells.slice(), starts: this.map.starts.slice(), cols: this.map.cols, rows: this.map.rows }); if (this.undo.length > 60) this.undo.shift(); }
  doUndo() { const u = this.undo.pop(); if (u) { Object.assign(this.map, u); this.render(); } }

  bindCanvas() {
    const cv = this.cv;
    let down = null, start = null, preview = null, last = null;
    const at = e => {
      const b = cv.getBoundingClientRect();
      return [Math.floor(((e.clientX - b.left) / b.width) * this.map.cols), Math.floor(((e.clientY - b.top) / b.height) * this.map.rows)];
    };
    const inside = ([c, r]) => c >= 0 && r >= 0 && c < this.map.cols && r < this.map.rows;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      const p = at(e); if (!inside(p)) return;
      this.pushUndo();
      const tile = e.button === 2 ? T.FLOOR : this.tile;
      if (tile === START_TOOL) { this.toggleStart(p); return; }
      down = tile; last = p; cv.setPointerCapture(e.pointerId);
      if (this.shape === 'fill') { this.fill(p, tile); down = null; }
      else if (this.shape === 'rect') { start = p; preview = p; this.render(start, preview); }
      else this.set(p, tile);
    });
    cv.addEventListener('pointermove', e => {
      if (down === null) return;
      const p = at(e); if (!inside(p)) return;
      if (this.shape === 'rect') { preview = p; this.render(start, preview); }
      else {
        const [x0, y0] = last, n = Math.max(Math.abs(p[0] - x0), Math.abs(p[1] - y0), 1);
        for (let k = 1; k <= n; k++) this.set([Math.round(x0 + ((p[0] - x0) * k) / n), Math.round(y0 + ((p[1] - y0) * k) / n)], down);
        last = p;
      }
    });
    cv.addEventListener('pointerup', () => {
      if (down !== null && this.shape === 'rect' && start) {
        for (let r = Math.min(start[1], preview[1]); r <= Math.max(start[1], preview[1]); r++)
          for (let c = Math.min(start[0], preview[0]); c <= Math.max(start[0], preview[0]); c++) this.map.cells[r * this.map.cols + c] = down;
        this.render();
      }
      down = null; start = null;
    });
  }

  toggleStart([c, r]) {
    const i = r * this.map.cols + c, s = this.map.starts;
    const k = s.indexOf(i);
    if (k >= 0) s.splice(k, 1);
    else if (s.length >= 8) return toast('أقصى شي 8 نقاط بداية');
    else { s.push(i); if (this.map.cells[i] === T.WALL) this.map.cells[i] = T.FLOOR; }
    this.render();
  }

  set([c, r], v) {
    const i = r * this.map.cols + c;
    if (this.map.cells[i] === v) return;
    this.map.cells[i] = v;
    this.render();
  }

  fill([c, r], v) {
    const m = this.map, target = m.cells[r * m.cols + c];
    if (target === v) return;
    const st = [[c, r]];
    while (st.length) {
      const [x, y] = st.pop();
      if (x < 0 || y < 0 || x >= m.cols || y >= m.rows || m.cells[y * m.cols + x] !== target) continue;
      m.cells[y * m.cols + x] = v;
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    this.render();
  }

  render(a, b) {
    const m = this.map;
    drawMazePreview(this.cv, m, S);
    const ctx = this.cv.getContext('2d');
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1;
    for (let c = 1; c < m.cols; c++) { ctx.beginPath(); ctx.moveTo(c * S + 0.5, 0); ctx.lineTo(c * S + 0.5, m.rows * S); ctx.stroke(); }
    for (let r = 1; r < m.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * S + 0.5); ctx.lineTo(m.cols * S, r * S + 0.5); ctx.stroke(); }
    m.starts.forEach((i, k) => {
      const c = i % m.cols, r = Math.floor(i / m.cols);
      ctx.fillStyle = RACER_COLORS[k]; ctx.fillRect(c * S + 4, r * S + 4, S - 8, S - 8);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(k + 1, c * S + S / 2, r * S + S / 2 + 1);
    });
    if (a && b) {
      ctx.strokeStyle = '#e53935'; ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(a[0], b[0]) * S, Math.min(a[1], b[1]) * S, (Math.abs(a[0] - b[0]) + 1) * S, (Math.abs(a[1] - b[1]) + 1) * S);
    }
    const count = v => m.cells.filter(x => x === v).length;
    $('#mzStats', this.root).textContent = `🚩 ${m.starts.length}/8 بداية · 🏁 ${count(T.FINISH)} نهاية · ⬛ ${count(T.BREAK)} ينكسر · 🎁 ${count(T.ITEM)} أيتم`;
  }
}
