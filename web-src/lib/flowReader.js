// Trình đọc dạng chảy cho EPUB / TXT / chữ OCR: render chương nối tiếp
// trong một vùng cuộn; highlight gắn bằng trích dẫn (quote) — tìm lại vị
// trí trong DOM bằng bản đồ ký tự đã chuẩn hoá khoảng trắng.

// Chuẩn hoá 1 chuỗi, map[i] = offset gốc của ký tự chuẩn hoá thứ i.
function normalizeWithMap(text) {
  let norm = '';
  const map = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!prevSpace) { norm += ' '; map.push(i); prevSpace = true; }
    } else { norm += text[i]; map.push(i); prevSpace = false; }
  }
  if (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
  return { norm, map };
}

function textNodesOf(el) {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement?.closest('mark, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

// Tìm Range của quote trong el; hint = offset chuẩn hoá gần đúng để chọn
// đúng occurrence khi quote lặp lại. Trả null nếu không thấy.
export function findRangeInElement(el, quote, hint = -1) {
  const nodes = textNodesOf(el);
  if (!nodes.length) return null;
  const starts = [];
  let full = '';
  nodes.forEach((nd, i) => { starts[i] = full.length; full += nd.textContent; });
  const { norm, map } = normalizeWithMap(full);
  const q = String(quote || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  let idx = -1;
  if (hint >= 0) {
    let best = -1, bestDist = Infinity, from = 0;
    while (true) {
      const i = norm.indexOf(q, from);
      if (i < 0) break;
      const d = Math.abs(i - hint);
      if (d < bestDist) { bestDist = d; best = i; }
      from = i + 1;
    }
    idx = best;
  } else idx = norm.indexOf(q);
  if (idx < 0) return null;
  const startRaw = map[idx];
  const endRaw = map[idx + q.length - 1] + 1;
  const locate = raw => {
    let lo = 0, hi = nodes.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= raw) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return { node: nodes[ans], offset: raw - starts[ans] };
  };
  const s = locate(startRaw), e = locate(endRaw);
  const range = document.createRange();
  range.setStart(s.node, Math.min(s.offset, s.node.textContent.length));
  range.setEnd(e.node, Math.min(e.offset, e.node.textContent.length));
  return range;
}

function wrapRange(range, h) {
  const mark = document.createElement('mark');
  mark.className = 'hl';
  mark.dataset.hlId = h.id;
  mark.style.background = h.color;
  if (h.note) mark.classList.add('has-note');
  try {
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    return true;
  } catch { return false; }
}

export class FlowReader {
  // chapters: [{title, html}] (html đã sạch) — hoặc [{title, text}] cho TXT/OCR
  constructor(container, { onSelection, onChapterChange } = {}) {
    this.container = container;
    this.onSelection = onSelection;
    this.onChapterChange = onChapterChange;
    this.highlights = [];
  }

  load(chapters) {
    this.chapters = chapters;
    this.container.innerHTML = '';
    this.chapterEls = chapters.map((ch, i) => {
      const sec = document.createElement('section');
      sec.className = 'flow-chapter';
      sec.dataset.chapter = i;
      const h = document.createElement('h2');
      h.className = 'flow-ch-title';
      h.textContent = ch.title || '';
      sec.appendChild(h);
      const body = document.createElement('div');
      body.className = 'flow-body';
      if (ch.html) body.innerHTML = ch.html;
      else (ch.text || '').split(/\n{2,}/).forEach(p => {
        const el = document.createElement('p');
        el.textContent = p;
        body.appendChild(el);
      });
      sec.appendChild(body);
      this.container.appendChild(sec);
      return sec;
    });
    this.applyHighlights();
    this.container.addEventListener('scroll', () => this.track(), { passive: true });
  }

  track() {
    const mid = this.container.scrollTop + this.container.clientHeight / 3;
    let cur = 0;
    this.chapterEls.forEach((el, i) => { if (el.offsetTop <= mid) cur = i; });
    if (cur !== this.currentChapter) { this.currentChapter = cur; this.onChapterChange?.(cur); }
  }

  setHighlights(list) { this.highlights = list || []; this.applyHighlights(); }

  applyHighlights() {
    if (!this.chapterEls) return;
    // Xoá mark cũ: unwrap
    this.container.querySelectorAll('mark.hl').forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    });
    // Gom theo chương, tìm Range trước rồi mới bọc (từ cuối lên đầu chương)
    const byChapter = new Map();
    for (const h of this.highlights) {
      if (h.locator?.kind !== 'flow') continue;
      const c = h.locator.chapter;
      if (!byChapter.has(c)) byChapter.set(c, []);
      byChapter.get(c).push(h);
    }
    for (const [c, list] of byChapter) {
      const sec = this.chapterEls[c];
      if (!sec) continue;
      const body = sec.querySelector('.flow-body');
      const jobs = [];
      for (const h of list) {
        const range = findRangeInElement(body, h.quote, h.locator.hint ?? -1);
        if (range) jobs.push({ range, h, pos: range.startOffset });
      }
      // Bọc theo thứ tự xuất hiện ngược để không lệch Range đã tính
      jobs.sort((a, b) => (a.range.startContainer === b.range.startContainer ? b.pos - a.pos : 0));
      for (const j of jobs.reverse()) wrapRange(j.range, j.h);
    }
  }

  currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.container.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const sec = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('.flow-chapter');
    if (!sec) return null;
    const chapter = +sec.dataset.chapter;
    // hint: độ dài text chuẩn hoá từ đầu chương tới điểm bắt đầu chọn
    let hint = -1;
    try {
      const pre = document.createRange();
      pre.setStart(sec.querySelector('.flow-body'), 0);
      pre.setEnd(range.startContainer, range.startOffset);
      hint = pre.toString().replace(/\s+/g, ' ').length;
    } catch {}
    return { text, locator: { kind: 'flow', chapter, hint } };
  }

  goToChapter(i, quote) {
    const sec = this.chapterEls[i];
    if (!sec) return;
    this.container.scrollTo({ top: sec.offsetTop - 8, behavior: 'smooth' });
    if (quote) {
      setTimeout(() => {
        const r = findRangeInElement(sec.querySelector('.flow-body'), quote);
        if (r) {
          const el = document.createElement('span');
          try { r.surroundContents(el); el.className = 'flash'; setTimeout(() => { el.replaceWith(...el.childNodes); }, 1600); } catch {}
          el.scrollIntoView?.({ block: 'center' });
        }
      }, 350);
    }
  }

  setFont(px) { this.container.style.setProperty('--reader-font', px + 'px'); }
  setTheme(name) { this.container.dataset.theme = name; }
  destroy() {}
}
