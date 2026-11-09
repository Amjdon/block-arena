// Tiny pixel-art editor used for item icons and paddle textures.
export class PixelEditor {
  constructor(container, { w = 16, h = 16, scale = 16, onChange } = {}) {
    this.w = w; this.h = h; this.scale = scale; this.onChange = onChange;
    this.data = new Array(w * h).fill(null);
    container.innerHTML = `
      <div class="pix-tools">
        <input type="color" value="#ffffff" title="اللون">
        <button type="button" data-t="pen" class="on">✏ قلم</button>
        <button type="button" data-t="erase">🧽 ممسحة</button>
        <button type="button" data-t="fill">🪣 تعبئة</button>
        <button type="button" data-a="clear">🗑 مسح الكل</button>
      </div>
      <canvas class="pix-canvas"></canvas>`;
    this.colorIn = container.querySelector('input');
    this.cv = container.querySelector('canvas');
    this.cv.width = w * scale; this.cv.height = h * scale;
    this.tool = 'pen';
    container.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      this.tool = b.dataset.t;
      container.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b));
    });
    container.querySelector('[data-a=clear]').onclick = () => { this.data.fill(null); this.changed(); };
    let drawing = false;
    const at = e => {
      const r = this.cv.getBoundingClientRect();
      return [Math.floor(((e.clientX - r.left) / r.width) * w), Math.floor(((e.clientY - r.top) / r.height) * h)];
    };
    const paint = (e, erase) => {
      const [x, y] = at(e);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      if (this.tool === 'fill' && !erase) return this.fill(x, y, this.colorIn.value);
      this.data[y * w + x] = erase || this.tool === 'erase' ? null : this.colorIn.value;
      this.changed();
    };
    this.cv.addEventListener('contextmenu', e => e.preventDefault());
    this.cv.addEventListener('pointerdown', e => { drawing = true; this.cv.setPointerCapture(e.pointerId); paint(e, e.button === 2); });
    this.cv.addEventListener('pointermove', e => { if (drawing && this.tool !== 'fill') paint(e, e.buttons === 2); });
    this.cv.addEventListener('pointerup', () => { drawing = false; });
    this.render();
  }
  fill(x, y, col) {
    const target = this.data[y * this.w + x];
    if (target === col) return;
    const st = [[x, y]];
    while (st.length) {
      const [a, b] = st.pop();
      if (a < 0 || b < 0 || a >= this.w || b >= this.h || this.data[b * this.w + a] !== target) continue;
      this.data[b * this.w + a] = col;
      st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
    }
    this.changed();
  }
  changed() { this.render(); this.onChange?.(); }
  render() {
    const c = this.cv.getContext('2d'), s = this.scale;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const v = this.data[y * this.w + x];
      c.fillStyle = v || ((x + y) % 2 ? '#2b2b2b' : '#333');
      c.fillRect(x * s, y * s, s, s);
    }
  }
  isEmpty() { return this.data.every(v => !v); }
  toDataURL() {
    if (this.isEmpty()) return '';
    const cv = document.createElement('canvas'); cv.width = this.w; cv.height = this.h;
    const c = cv.getContext('2d');
    this.data.forEach((v, i) => { if (v) { c.fillStyle = v; c.fillRect(i % this.w, Math.floor(i / this.w), 1, 1); } });
    return cv.toDataURL('image/png');
  }
  async load(src) {
    this.data.fill(null);
    if (src) {
      const img = await loadImage(src);
      const cv = document.createElement('canvas'); cv.width = this.w; cv.height = this.h;
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(img, 0, 0, this.w, this.h);
      const px = c.getImageData(0, 0, this.w, this.h).data;
      for (let i = 0; i < this.w * this.h; i++) {
        if (px[i * 4 + 3] > 100) this.data[i] = '#' + [0, 1, 2].map(k => px[i * 4 + k].toString(16).padStart(2, '0')).join('');
      }
    }
    this.render();
  }
}

export function loadImage(src) {
  return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
}

export function readFile(file) {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
}

// Resize an uploaded image to at most maxW x maxH and return a PNG data URL.
export async function fileToDataURL(file, maxW, maxH) {
  const img = await loadImage(await readFile(file));
  const k = Math.min(1, maxW / img.width, maxH / img.height);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');
}
