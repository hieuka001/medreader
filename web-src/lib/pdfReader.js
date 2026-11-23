// Trình đọc PDF trên pdf.js: canvas + text layer (bôi đen được) +
// lớp highlight theo toạ độ chuẩn hoá (0..1 theo trang).
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { isScannedText } from './ocrutil.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

export class PdfReader {
  constructor(container, { onSelection, onPageChange } = {}) {
    this.container = container;
    this.onSelection = onSelection;
    this.onPageChange = onPageChange;
    this.pages = new Map(); // n -> {el, canvas, textLayerEl, hlLayer, rendered, viewport}
    this.highlights = [];
    this.scale = 0; // tính theo bề rộng container
  }

  async load(data) {
    this.doc = await pdfjsLib.getDocument({
      data,
      cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href,
    }).promise;
    this.pageCount = this.doc.numPages;
    const first = await this.doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    this.pageRatio = vp.height / vp.width;
    this.container.innerHTML = '';
    this.pageEls = [];
    for (let n = 1; n <= this.pageCount; n++) {
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.page = n;
      el.innerHTML = `<canvas></canvas><div class="hl-layer"></div><div class="textLayer"></div><div class="page-num">${n}</div>`;
      this.container.appendChild(el);
      this.pageEls.push(el);
      this.pages.set(n, { el, rendered: false });
    }
    this.layout();
    this.observer = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) this.renderPage(+e.target.dataset.page);
    }, { root: this.container, rootMargin: '600px 0px' });
    this.pageEls.forEach(el => this.observer.observe(el));
    this.container.addEventListener('scroll', () => this.trackPage(), { passive: true });
    return { pageCount: this.pageCount };
  }

  layout() {
    const w = this.container.clientWidth - 16;
    const h = Math.round(w * this.pageRatio);
    for (const el of this.pageEls) { el.style.width = w + 'px'; el.style.height = h + 'px'; }
  }

  trackPage() {
    const mid = this.container.scrollTop + this.container.clientHeight / 3;
    let cur = 1;
    for (const el of this.pageEls) { if (el.offsetTop <= mid) cur = +el.dataset.page; else break; }
    if (cur !== this.currentPage) { this.currentPage = cur; this.onPageChange?.(cur); }
  }

  async renderPage(n) {
    const rec = this.pages.get(n);
    if (!rec || rec.rendered) return;
    rec.rendered = true;
    const page = await this.doc.getPage(n);
    const w = rec.el.clientWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = page.getViewport({ scale: 1 });
    const scale = (w / base.width) * dpr;
    const viewport = page.getViewport({ scale });
    const canvas = rec.el.querySelector('canvas');
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    canvas.style.width = w + 'px'; canvas.style.height = (w * this.pageRatio) + 'px';
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Text layer (CSS pixels)
    const tl = rec.el.querySelector('.textLayer');
    tl.innerHTML = '';
    const cssViewport = page.getViewport({ scale: w / base.width });
    tl.style.width = w + 'px'; tl.style.height = (w * this.pageRatio) + 'px';
    tl.style.setProperty('--scale-factor', String(w / base.width));
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: await page.getTextContent(),
      container: tl,
      viewport: cssViewport,
    });
    await textLayer.render();
    rec.textLayer = textLayer;
    this.drawHighlights(n);
  }

  setHighlights(list) {
    this.highlights = list || [];
    for (const n of this.pages.keys()) this.drawHighlights(n);
  }

  drawHighlights(n) {
    const rec = this.pages.get(n);
    if (!rec) return;
    const layer = rec.el.querySelector('.hl-layer');
    if (!layer) return;
    layer.innerHTML = '';
    for (const h of this.highlights) {
      if (h.locator?.kind !== 'pdf' || h.locator.page !== n) continue;
      for (const r of h.locator.rects || []) {
        const d = document.createElement('div');
        d.className = 'hl-rect';
        d.dataset.hlId = h.id;
        d.style.left = (r.x * 100) + '%'; d.style.top = (r.y * 100) + '%';
        d.style.width = (r.w * 100) + '%'; d.style.height = (r.h * 100) + '%';
        d.style.background = h.color;
        layer.appendChild(d);
      }
    }
  }

  // Selection hiện tại -> {text, locator{kind:'pdf', page, rects}} hoặc null
  currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.container.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const rects = [];
    let firstPage = null;
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (const el of this.pageEls) {
        const pr = el.getBoundingClientRect();
        if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
          const page = +el.dataset.page;
          if (!firstPage) firstPage = page;
          rects.push({ page, x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height });
          break;
        }
      }
    }
    if (!rects.length || !firstPage) return null;
    const pageRects = rects.filter(r => r.page === firstPage).map(({ x, y, w, h }) => ({ x, y, w, h }));
    return { text, locator: { kind: 'pdf', page: firstPage, rects: pageRects.length ? pageRects : rects.map(({ x, y, w, h }) => ({ x, y, w, h })) } };
  }

  async pageText(n) {
    const page = await this.doc.getPage(n);
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join(' ');
  }

  async isScannedPage(n) { return isScannedText(await this.pageText(n)); }

  async outline() {
    try {
      const ol = await this.doc.getOutline();
      if (!ol) return [];
      const walk = async (items, out) => {
        for (const it of items || []) {
          let page = null;
          try {
            const dest = typeof it.dest === 'string' ? await this.doc.getDestination(it.dest) : it.dest;
            if (dest?.[0]) page = (await this.doc.getPageIndex(dest[0])) + 1;
          } catch {}
          out.push({ title: it.title, page });
          if (it.items?.length) await walk(it.items, out);
        }
        return out;
      };
      return walk(ol, []);
    } catch { return []; }
  }

  goToPage(n) {
    const el = this.pages.get(n)?.el;
    if (el) this.container.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  }

  async coverBlob() {
    const page = await this.doc.getPage(1);
    const vp = page.getViewport({ scale: 0.5 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
  }

  // Render một trang thành ảnh PNG (cho OCR)
  async pageImageBlob(n, scale = 2.2) {
    const page = await this.doc.getPage(n);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return new Promise(res => c.toBlob(res, 'image/png'));
  }

  destroy() { this.observer?.disconnect(); this.doc?.destroy(); }
}
