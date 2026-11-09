// Map editor: paint walls / colored blocks, fill, rectangles, image import, settings, item pool.
import { drawCell } from './game.js';
import { $, $$, esc, toast } from './store.js';
import { readFile, loadImage } from './pixel.js';

const SWATCHES = ['#c94a4a', '#3b5a8c', '#e0b040', '#3fa36a', '#a35bff', '#ff8a3d', '#2ec4b6', '#ff5c8a', '#eeeeee'];
const S = 14; // editor pixels per cell

export function blankMap(cols = 40, rows = 34) {
  return { name: 'ماب جديد', cols, rows, palette: [], cells: new Array(cols * rows).fill(0), dropChance: 0.1, items: ['multi3', 'wide', 'fire', 'life'], ballSpeed: 5, lives: 3, paddleWidth: 100 };
}

export function compactMap(map) {
  const used = new Map(), palette = [];
  const cells = map.cells.map(v => {
    if (v < 2) return v;
    const col = map.palette[v - 2];
    if (!used.has(col)) { used.set(col, palette.length + 2); palette.push(col); }
    return used.get(col);
  });
  return { ...map, palette, cells };
}

export class MapEditor {
  constructor(root, { getItems, onTest, onSave }) {
    this.root = root; this.getItems = getItems; this.onTest = onTest; this.onSave = onSave;
    this.tool = 'paint'; this.color = SWATCHES[0]; this.undo = [];
    root.innerHTML = `
      <div class="ed-bar">
        <div class="group">
          <button data-tool="wall" title="بلوك رصاصي ما ينكسر">🧱 مانع</button>
          <button data-tool="paint" class="on">🎨 لون</button>
          <button data-tool="erase">🧽 مسح</button>
          <button data-tool="fill">🪣 تعبئة</button>
          <button data-tool="rect">▭ مستطيل</button>
        </div>
        <div class="group swatches"><input type="color" id="edColor" value="${SWATCHES[0]}"><span id="edSw"></span></div>
        <div class="group">
          <button id="edUndo">↶ تراجع</button>
          <button id="edNew">📄 جديد</button>
          <label class="btn">🖼 صورة → ماب<input type="file" accept="image/*" id="edImg" hidden></label>
          <button id="edExport">⬇ JSON</button>
          <label class="btn">⬆ JSON<input type="file" accept=".json" id="edImport" hidden></label>
        </div>
      </div>
      <div class="ed-main">
        <div class="ed-canvas-wrap" dir="ltr"><canvas id="edCanvas"></canvas><div class="ed-open">⬇ منطقة المضرب (فاضية)</div></div>
        <div class="ed-side card">
          <label>اسم الماب <input id="edName" maxlength="40"></label>
          <div class="row2">
            <label>عرض <input type="number" id="edCols" min="8" max="80"></label>
            <label>طول <input type="number" id="edRows" min="4" max="80"></label>
            <button id="edResize">تطبيق</button>
          </div>
          <label>نسبة نزول الأيتمز <span id="edDropV"></span><input type="range" id="edDrop" min="0" max="1" step="0.01"></label>
          <label>سرعة الكورة <span id="edSpeedV"></span><input type="range" id="edSpeed" min="2" max="12" step="0.5"></label>
          <div class="row2">
            <label>الأرواح <input type="number" id="edLives" min="1" max="9"></label>
            <label>عرض المضرب <input type="number" id="edPw" min="30" max="300"></label>
          </div>
          <div class="sub">الأيتمز اللي تنزل في الماب:</div>
          <div id="edItems" class="item-checks"></div>
          <div class="stats" id="edStats"></div>
          <div class="row2">
            <button class="primary" id="edTest">▶ جرّب</button>
            <button class="primary" id="edSave">☁ ارفع للساندبوكس</button>
          </div>
        </div>
      </div>`;
    this.cv = $('#edCanvas', root);
    $$('[data-tool]', root).forEach(b => b.onclick = () => {
      this.tool = b.dataset.tool;
      $$('[data-tool]', root).forEach(x => x.classList.toggle('on', x === b));
    });
    $('#edColor', root).oninput = e => { this.color = e.target.value; this.setTool('paint'); };
    $('#edUndo', root).onclick = () => this.doUndo();
    $('#edNew', root).onclick = () => { if (confirm('تبدأ ماب جديد؟')) this.load(blankMap()); };
    $('#edResize', root).onclick = () => this.resize(+$('#edCols', root).value, +$('#edRows', root).value);
    $('#edExport', root).onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(this.collect())], { type: 'application/json' }));
      a.download = (this.map.name || 'map') + '.json'; a.click();
    };
    $('#edImport', root).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const m = JSON.parse(await f.text()); delete m.id; this.load(m); } catch { toast('ملف غير صحيح'); }
      e.target.value = '';
    };
    $('#edImg', root).onchange = async e => { const f = e.target.files[0]; if (f) await this.importImage(f); e.target.value = ''; };
    $('#edTest', root).onclick = () => this.onTest(this.collect());
    $('#edSave', root).onclick = () => this.onSave(this.collect());
    for (const id of ['edDrop', 'edSpeed']) $('#' + id, root).oninput = () => this.syncLabels();
    document.addEventListener('keydown', e => {
      if (root.offsetParent && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.doUndo(); }
    });
    this.bindCanvas();
    this.load(blankMap());
  }

  setTool(t) { $$('[data-tool]', this.root).forEach(x => x.classList.toggle('on', x.dataset.tool === t)); this.tool = t; }

  load(map) {
    this.map = compactMap({ ...blankMap(map.cols, map.rows), ...map });
    this.undo = [];
    const r = this.root;
    $('#edName', r).value = this.map.name;
    $('#edCols', r).value = this.map.cols; $('#edRows', r).value = this.map.rows;
    $('#edDrop', r).value = this.map.dropChance; $('#edSpeed', r).value = this.map.ballSpeed;
    $('#edLives', r).value = this.map.lives; $('#edPw', r).value = this.map.paddleWidth;
    this.cv.width = this.map.cols * S; this.cv.height = this.map.rows * S;
    this.syncLabels(); this.refreshItems(); this.render();
  }

  refreshItems() {
    const items = this.getItems();
    const sel = new Set(this.map.items);
    $('#edItems', this.root).innerHTML = Object.values(items).map(it => `
      <label class="chk"><input type="checkbox" value="${esc(it.id)}" ${sel.has(it.id) ? 'checked' : ''}>
      <span class="ico" style="background:${esc(it.color)}">${it.icon ? `<img src="${esc(it.icon)}">` : esc(it.label)}</span>${esc(it.name)}</label>`).join('');
  }

  syncLabels() {
    $('#edDropV', this.root).textContent = Math.round($('#edDrop', this.root).value * 100) + '%';
    $('#edSpeedV', this.root).textContent = $('#edSpeed', this.root).value;
  }

  collect() {
    const r = this.root;
    this.map.name = $('#edName', r).value.trim() || 'ماب جديد';
    this.map.dropChance = +$('#edDrop', r).value;
    this.map.ballSpeed = +$('#edSpeed', r).value;
    this.map.lives = +$('#edLives', r).value || 3;
    this.map.paddleWidth = +$('#edPw', r).value || 100;
    this.map.items = $$('#edItems input:checked', r).map(i => i.value);
    return compactMap(this.map);
  }

  resize(cols, rows) {
    cols = Math.max(8, Math.min(80, cols | 0)); rows = Math.max(4, Math.min(80, rows | 0));
    this.pushUndo();
    const m = this.map, cells = new Array(cols * rows).fill(0);
    for (let r = 0; r < Math.min(rows, m.rows); r++) for (let c = 0; c < Math.min(cols, m.cols); c++) cells[r * cols + c] = m.cells[r * m.cols + c];
    Object.assign(m, { cols, rows, cells });
    this.cv.width = cols * S; this.cv.height = rows * S;
    this.render();
  }

  valueFor(tool) {
    if (tool === 'wall') return 1;
    if (tool === 'erase') return 0;
    let k = this.map.palette.indexOf(this.color);
    if (k < 0) { this.map.palette.push(this.color); k = this.map.palette.length - 1; }
    return k + 2;
  }

  pushUndo() { this.undo.push(this.map.cells.slice()); if (this.undo.length > 60) this.undo.shift(); }
  doUndo() { const c = this.undo.pop(); if (c && c.length === this.map.cells.length) { this.map.cells = c; this.render(); } }

  bindCanvas() {
    const cv = this.cv;
    let down = false, start = null, preview = null, last = null;
    const at = e => {
      const r = cv.getBoundingClientRect();
      return [Math.floor(((e.clientX - r.left) / r.width) * this.map.cols), Math.floor(((e.clientY - r.top) / r.height) * this.map.rows)];
    };
    const inside = ([c, r]) => c >= 0 && r >= 0 && c < this.map.cols && r < this.map.rows;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      const p = at(e); if (!inside(p)) return;
      const tool = e.button === 2 ? 'erase' : this.tool;
      this.pushUndo(); down = tool; last = p; cv.setPointerCapture(e.pointerId);
      if (tool === 'fill') { this.fill(p, this.valueFor('paint')); down = false; }
      else if (tool === 'rect') { start = p; preview = p; this.render(start, preview); }
      else this.set(p, this.valueFor(tool));
    });
    cv.addEventListener('pointermove', e => {
      if (!down) return;
      const p = at(e); if (!inside(p)) return;
      if (down === 'rect') { preview = p; this.render(start, preview); }
      else {
        // interpolate so fast strokes don't leave gaps
        const [x0, y0] = last || p, n = Math.max(Math.abs(p[0] - x0), Math.abs(p[1] - y0), 1);
        for (let k = 1; k <= n; k++) this.set([Math.round(x0 + ((p[0] - x0) * k) / n), Math.round(y0 + ((p[1] - y0) * k) / n)], this.valueFor(down));
      }
      last = p;
    });
    cv.addEventListener('pointerup', () => {
      if (down === 'rect' && start) {
        const v = this.valueFor('paint');
        for (let r = Math.min(start[1], preview[1]); r <= Math.max(start[1], preview[1]); r++)
          for (let c = Math.min(start[0], preview[0]); c <= Math.max(start[0], preview[0]); c++) this.map.cells[r * this.map.cols + c] = v;
        this.render();
      }
      down = false; start = null;
    });
  }

  set([c, r], v) {
    const i = r * this.map.cols + c;
    if (this.map.cells[i] === v) return;
    this.map.cells[i] = v;
    const ctx = this.cv.getContext('2d');
    this.drawOne(ctx, c, r);
    this.updateStats();
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

  async importImage(file) {
    const img = await loadImage(await readFile(file));
    const m = this.map, cv = document.createElement('canvas');
    cv.width = m.cols; cv.height = m.rows;
    const c = cv.getContext('2d');
    const k = Math.min(m.cols / img.width, m.rows / img.height);
    const w = img.width * k, h = img.height * k;
    c.drawImage(img, (m.cols - w) / 2, (m.rows - h) / 2, w, h);
    const px = c.getImageData(0, 0, m.cols, m.rows).data;
    this.pushUndo();
    for (let i = 0; i < m.cols * m.rows; i++) {
      if (px[i * 4 + 3] < 128) { m.cells[i] = 0; continue; }
      const q = v => Math.min(255, Math.round(v / 36) * 36).toString(16).padStart(2, '0');
      const col = '#' + q(px[i * 4]) + q(px[i * 4 + 1]) + q(px[i * 4 + 2]);
      let idx = m.palette.indexOf(col);
      if (idx < 0) { m.palette.push(col); idx = m.palette.length - 1; }
      m.cells[i] = idx + 2;
    }
    this.render();
    toast('تم تحويل الصورة لبلوكات');
  }

  drawOne(ctx, c, r) {
    ctx.fillStyle = (c + r) % 2 ? '#202020' : '#242424';
    ctx.fillRect(c * S, r * S, S, S);
    drawCell(ctx, this.map, this.map.cells[r * this.map.cols + c], c, r, S);
  }

  render(a, b) {
    const ctx = this.cv.getContext('2d'), m = this.map;
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) this.drawOne(ctx, c, r);
    if (a && b) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      const x = Math.min(a[0], b[0]) * S, y = Math.min(a[1], b[1]) * S;
      ctx.strokeRect(x, y, (Math.abs(a[0] - b[0]) + 1) * S, (Math.abs(a[1] - b[1]) + 1) * S);
    }
    this.renderSwatches(); this.updateStats();
  }

  renderSwatches() {
    const used = [...new Set([...SWATCHES, ...this.map.palette])].slice(0, 24);
    const sw = $('#edSw', this.root);
    sw.innerHTML = used.map(c => `<button class="sw ${c === this.color ? 'on' : ''}" style="background:${c}" data-c="${c}"></button>`).join('');
    $$('.sw', sw).forEach(b => b.onclick = () => { this.color = b.dataset.c; $('#edColor', this.root).value = this.color; this.setTool('paint'); this.renderSwatches(); });
  }

  updateStats() {
    let walls = 0, blocks = 0;
    for (const v of this.map.cells) { if (v === 1) walls++; else if (v >= 2) blocks++; }
    $('#edStats', this.root).textContent = `🧱 ${walls} مانع · 🟥 ${blocks} بلوك ملون`;
  }
}
