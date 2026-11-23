// MedReader — app đọc sách iOS: thư viện + trình đọc PDF/EPUB/TXT +
// dịch Gemini kiểu MedGloss + highlight/ghi chú/dấu trang + OCR Vision.
import { Books, Highlights, Bookmarks, OcrStore, uid } from './lib/db.js';
import { PdfReader } from './lib/pdfReader.js';
import { FlowReader } from './lib/flowReader.js';
import { parseEpub } from './lib/epub.js';
import { translateGloss, translateFull, getApiKey, setApiKey, getModel, setModel } from './lib/gemini.js';
import { glossToHtml } from './lib/gloss.js';
import { findAllFolded } from './lib/textfind.js';
import { mergeOcrLines } from './lib/ocrutil.js';

const $ = s => document.querySelector(s);
const Bridge = (method, opts) => {
  const cap = window.Capacitor;
  if (!cap?.nativePromise) return Promise.reject(new Error('Tính năng này cần chạy trong app iOS'));
  return cap.nativePromise('MedReaderBridge', method, opts || {});
};

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function loading(on, text) {
  $('#loading').hidden = !on;
  if (text) $('#loading-text').textContent = text;
}

const state = {
  book: null,          // meta sách đang mở
  mode: null,          // 'pdf' | 'flow' | 'ocr'
  reader: null,        // PdfReader | FlowReader
  chapters: null,      // flow chapters
  highlights: [],
  bookmarks: [],
  sel: null,           // selection hiện tại {text, locator}
  bubbleMode: 'gloss',
  bubbleText: '',
  bubbleFull: '',
  pdfScanned: new Map(), // page -> bool (cache kiểm tra scan)
};

// ================= THƯ VIỆN =================
async function renderLibrary() {
  const q = $('#lib-search').value.trim().toLowerCase();
  const sort = $('#lib-sort').value;
  let books = await Books.all();
  if (q) books = books.filter(b => (b.title + ' ' + b.author).toLowerCase().includes(q));
  if (sort === 'title') books.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'progress') books.sort((a, b) => (b.progress?.pct || 0) - (a.progress?.pct || 0));
  else books.sort((a, b) => b.addedAt - a.addedAt);
  const grid = $('#lib-grid');
  grid.innerHTML = '';
  $('#lib-empty').hidden = books.length > 0;
  for (const b of books) {
    const card = document.createElement('div');
    card.className = 'book-card';
    const coverUrl = b.cover ? URL.createObjectURL(b.cover) : null;
    card.innerHTML = `
      <div class="book-cover">
        ${coverUrl ? `<img src="${coverUrl}" alt="">` : `<span class="initial">${(b.title || '?').trim().charAt(0).toUpperCase()}</span>`}
        <span class="book-fmt">${b.format.toUpperCase()}</span>
        <button class="book-del" title="Xoá sách">✕</button>
      </div>
      <div class="book-title"></div>
      <div class="book-author"></div>
      <div class="book-prog"><div style="width:${Math.round((b.progress?.pct || 0) * 100)}%"></div></div>`;
    card.querySelector('.book-title').textContent = b.title;
    card.querySelector('.book-author').textContent = b.author || '';
    card.querySelector('.book-del').addEventListener('click', async e => {
      e.stopPropagation();
      if (confirm(`Xoá sách "${b.title}" khỏi thư viện?`)) { await Books.remove(b.id); renderLibrary(); }
    });
    card.addEventListener('click', () => openBook(b.id));
    grid.appendChild(card);
  }
}

async function importFiles(files) {
  for (const file of files) {
    try {
      loading(true, `Đang thêm "${file.name}"…`);
      const buf = await file.arrayBuffer();
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const book = {
        id: uid(), title: file.name.replace(/\.[^.]+$/, ''), author: '',
        format: ext, size: file.size, addedAt: Date.now(), progress: null, cover: null,
      };
      if (ext === 'pdf') {
        const { getDocument } = await import('./vendor/pdf.min.mjs');
        const doc = await getDocument({ data: buf.slice(0) }).promise;
        book.pageCount = doc.numPages;
        try {
          const md = await doc.getMetadata();
          if (md?.info?.Title) book.title = md.info.Title;
          if (md?.info?.Author) book.author = md.info.Author;
        } catch {}
        // Bìa: render trang 1
        const tmp = document.createElement('div');
        const r = new PdfReader(tmp, {});
        await r.load(buf.slice(0));
        book.cover = await r.coverBlob();
        r.destroy();
        await doc.destroy();
      } else if (ext === 'epub') {
        const parsed = await parseEpub(buf.slice(0));
        book.title = parsed.meta.title || book.title;
        book.author = parsed.meta.author || '';
        book.cover = parsed.coverBlob;
        book.chapterCount = parsed.chapters.length;
      } else if (ext === 'txt') {
        // đếm chương theo heading
        const text = new TextDecoder().decode(buf.slice(0));
        book.chapterCount = splitTxt(text).length;
      } else {
        toast(`Chưa hỗ trợ định dạng .${ext}`); continue;
      }
      await Books.putFile(book.id, new Blob([buf], { type: file.type || 'application/octet-stream' }));
      await Books.put(book);
      toast(`Đã thêm "${book.title}"`);
    } catch (e) {
      toast(`Thêm sách lỗi: ${e.message || e}`, 4000);
    } finally { loading(false); }
  }
  renderLibrary();
}

function splitTxt(text) {
  const lines = text.split(/\r?\n/);
  const chapters = [];
  let cur = { title: 'Bắt đầu', paras: [] };
  const headRe = /^\s*(chương|chuong|chapter|phần|phan|mục)\s+[\divxIVX0-9]+.*$/i;
  for (const ln of lines) {
    if (headRe.test(ln) && ln.trim().length < 90 && cur.paras.join('').length > 200) {
      chapters.push(cur);
      cur = { title: ln.trim(), paras: [] };
    } else if (ln.trim()) cur.paras.push(ln.trim());
  }
  chapters.push(cur);
  return chapters.filter(c => c.paras.length).map(c => ({ title: c.title, text: c.paras.join('\n\n') }));
}

// ================= MỞ SÁCH =================
async function openBook(id) {
  const book = await Books.get(id);
  if (!book) return;
  const blob = await Books.getFile(id);
  if (!blob) { toast('Không tìm thấy file sách'); return; }
  loading(true, 'Đang mở sách…');
  try {
    state.book = book;
    state.highlights = await Highlights.forBook(id);
    state.bookmarks = await Bookmarks.forBook(id);
    state.pdfScanned = new Map();
    $('#reader-book-title').textContent = book.title;
    showView('reader');
    const scroll = $('#reader-scroll');
    scroll.innerHTML = '';
    scroll.className = 'reader-scroll' + (book.format === 'pdf' ? '' : ' flow');
    const buf = await blob.arrayBuffer();
    if (book.format === 'pdf') {
      state.mode = 'pdf';
      const reader = new PdfReader(scroll, {
        onPageChange: page => { updatePdfPos(page); checkScanBanner(page); },
      });
      state.reader = reader;
      await reader.load(buf);
      reader.setHighlights(state.highlights);
      const start = book.progress?.page || 1;
      if (start > 1) setTimeout(() => reader.goToPage(start), 60);
      updatePdfPos(start);
      checkScanBanner(start);
    } else {
      state.mode = 'flow';
      let chapters;
      if (book.format === 'epub') {
        const parsed = await parseEpub(buf);
        chapters = parsed.chapters;
      } else {
        chapters = splitTxt(new TextDecoder().decode(buf));
      }
      state.chapters = chapters;
      const reader = new FlowReader(scroll, {
        onChapterChange: ch => updateFlowPos(ch),
      });
      state.reader = reader;
      reader.load(chapters);
      reader.setHighlights(state.highlights);
      applyReaderPrefs();
      const start = book.progress?.chapter || 0;
      if (start > 0) setTimeout(() => reader.goToChapter(start), 60);
      updateFlowPos(start);
    }
    $('#ocr-banner').hidden = state.mode !== 'pdf';
    if (state.mode === 'pdf') $('#ocr-banner').hidden = true; // banner chỉ hiện khi trang là scan
  } catch (e) {
    toast(`Mở sách lỗi: ${e.message || e}`, 4500);
    showView('library');
  } finally { loading(false); }
}

function updatePdfPos(page) {
  const total = state.reader.pageCount;
  $('#reader-pos').textContent = `Trang ${page} / ${total}`;
  $('#reader-progress-fill').style.width = (page / total * 100) + '%';
  saveProgress({ page, pct: page / total });
}
function updateFlowPos(ch) {
  const total = state.chapters.length;
  const title = state.chapters[ch]?.title || '';
  $('#reader-pos').textContent = `${title} · ${ch + 1}/${total}`;
  $('#reader-progress-fill').style.width = ((ch + 1) / total * 100) + '%';
  saveProgress({ chapter: ch, pct: (ch + 1) / total });
}
let saveTimer = null;
function saveProgress(p) {
  if (!state.book) return;
  state.book.progress = { ...(state.book.progress || {}), ...p };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => Books.put(state.book), 600);
}

function closeBook() {
  state.reader?.destroy?.();
  state.reader = null; state.book = null; state.chapters = null;
  hideSelbar(); hideBubble();
  showView('library');
  renderLibrary();
}

function showView(name) {
  $('#view-library').classList.toggle('active', name === 'library');
  $('#view-reader').classList.toggle('active', name === 'reader');
  $('#btn-bubble').style.display = name === 'reader' ? 'block' : 'none';
}

// Font + nền cho flow reader
function applyReaderPrefs() {
  const font = +(localStorage.getItem('medreader.font') || 18);
  const theme = localStorage.getItem('medreader.theme') || 'dark';
  const scroll = $('#reader-scroll');
  scroll.style.setProperty('--reader-font', font + 'px');
  scroll.dataset.theme = theme;
}

// ================= BÔI ĐEN + THANH HÀNH ĐỘNG =================
const selbar = $('#selbar');
function showSelbar(sel) {
  state.sel = sel;
  $('#selbar-quote').textContent = sel.text.length > 140 ? sel.text.slice(0, 140) + '…' : sel.text;
  selbar.hidden = false;
}
function hideSelbar() { selbar.hidden = true; state.sel = null; }

let selDebounce = null;
document.addEventListener('selectionchange', () => {
  clearTimeout(selDebounce);
  selDebounce = setTimeout(() => {
    if (!state.reader || $('#view-reader').classList.contains('active') === false) return;
    const sel = state.reader.currentSelection?.();
    if (sel) showSelbar(sel);
    else if (!$('#bubble').hidden) { /* giữ bubble */ }
    else hideSelbar();
  }, 350);
});

selbar.addEventListener('click', async e => {
  const actBtn = e.target.closest('[data-act]');
  const swatch = e.target.closest('.swatch');
  const sel = state.sel;
  if (!sel) return;
  if (swatch) {
    await addHighlight(sel, swatch.dataset.color, '');
    hideSelbar();
    window.getSelection()?.removeAllRanges();
    return;
  }
  if (!actBtn) return;
  const act = actBtn.dataset.act;
  if (act === 'gloss') openBubble(sel.text, 'gloss');
  else if (act === 'full') openBubble(sel.text, 'full');
  else if (act === 'copy') {
    try { await navigator.clipboard.writeText(sel.text); toast('Đã chép đoạn đã chọn'); } catch { toast('Không chép được'); }
    hideSelbar();
  } else if (act === 'speak') speak(sel.text, 'en-US');
  else if (act === 'note') {
    const note = prompt('Ghi chú cho đoạn này (để trống = chỉ highlight vàng):');
    if (note !== null) { await addHighlight(sel, '#ffe066', note.trim()); hideSelbar(); window.getSelection()?.removeAllRanges(); }
  }
});

async function addHighlight(sel, color, note) {
  const h = {
    id: uid(), bookId: state.book.id, color, note: note || '',
    quote: sel.text, locator: sel.locator, createdAt: Date.now(),
  };
  await Highlights.put(h);
  state.highlights.push(h);
  state.reader.setHighlights(state.highlights);
  toast(note ? 'Đã highlight + ghi chú' : 'Đã highlight');
}

function speak(text, lang) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    speechSynthesis.speak(u);
  } catch { toast('Máy không hỗ trợ đọc thành tiếng'); }
}

// ================= BONG BÓNG DỊCH =================
const bubble = $('#bubble');
function openBubble(text, mode) {
  state.bubbleText = text || '';
  state.bubbleFull = '';
  setBubbleMode(mode || 'gloss');
  $('#bubble-src').textContent = text || '';
  $('#bubble-input').hidden = !!text;
  $('#bubble-go').hidden = !!text;
  bubble.hidden = false;
  hideSelbar();
  if (text) runBubbleTranslate();
}
function hideBubble() { bubble.hidden = true; }
function setBubbleMode(mode) {
  state.bubbleMode = mode;
  $('#tab-gloss').classList.toggle('active', mode === 'gloss');
  $('#tab-full').classList.toggle('active', mode === 'full');
}
async function runBubbleTranslate() {
  const text = state.bubbleText.trim();
  const out = $('#bubble-out');
  if (!text) { out.innerHTML = ''; return; }
  if (!getApiKey()) {
    out.innerHTML = '<span class="err">Chưa có Gemini API key — bấm ⚙️ ở thư viện để dán key một lần.</span>';
    return;
  }
  out.innerHTML = '<span class="loading-text">Đang dịch…</span>';
  try {
    if (state.bubbleMode === 'gloss') {
      const phrases = await translateGloss(text);
      out.innerHTML = glossToHtml(phrases);
      state.bubbleFull = phrases.map(p => p.vi).join(' ');
    } else {
      const full = await translateFull(text);
      state.bubbleFull = full;
      out.textContent = full;
    }
  } catch (e) {
    out.innerHTML = `<span class="err">Dịch lỗi: ${e.message || e}</span>`;
  }
}
$('#tab-gloss').addEventListener('click', () => { setBubbleMode('gloss'); runBubbleTranslate(); });
$('#tab-full').addEventListener('click', () => { setBubbleMode('full'); runBubbleTranslate(); });
$('#bubble-close').addEventListener('click', hideBubble);
$('#bubble-go').addEventListener('click', () => {
  state.bubbleText = $('#bubble-input').value.trim();
  $('#bubble-src').textContent = state.bubbleText;
  runBubbleTranslate();
});
$('#bubble-speak').addEventListener('click', () => {
  if (state.bubbleFull) speak(state.bubbleFull, 'vi-VN');
  else if (state.bubbleText) speak(state.bubbleText, 'en-US');
});
$('#btn-bubble').addEventListener('click', () => {
  if (!bubble.hidden) { hideBubble(); return; }
  const sel = state.reader?.currentSelection?.();
  openBubble(sel?.text || '', 'gloss');
});

// ================= SHEET (panel) =================
const sheet = $('#sheet'), backdrop = $('#sheet-backdrop');
function openSheet(title, build) {
  $('#sheet-title').textContent = title;
  const body = $('#sheet-body');
  body.innerHTML = '';
  build(body);
  sheet.hidden = false; backdrop.hidden = false;
}
function closeSheet() { sheet.hidden = true; backdrop.hidden = true; }
$('#sheet-close').addEventListener('click', closeSheet);
backdrop.addEventListener('click', closeSheet);
function row(body, title, sub, onclick) {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<div class="t"></div>${sub ? '<div class="s"></div>' : ''}`;
  d.querySelector('.t').textContent = title;
  if (sub) d.querySelector('.s').textContent = sub;
  if (onclick) d.addEventListener('click', onclick);
  body.appendChild(d);
  return d;
}

// Mục lục
$('#btn-toc').addEventListener('click', async () => {
  if (!state.book) return;
  openSheet('Mục lục', async body => {
    if (state.mode === 'pdf') {
      const ol = await state.reader.outline();
      if (!ol.length) { body.innerHTML = '<p class="muted">PDF này không có mục lục sẵn. Dùng 🔖 để tự đánh dấu trang.</p>'; return; }
      ol.forEach(it => row(body, it.title, it.page ? `Trang ${it.page}` : '', () => { closeSheet(); if (it.page) state.reader.goToPage(it.page); }));
    } else {
      state.chapters.forEach((c, i) => row(body, c.title || `Phần ${i + 1}`, '', () => { closeSheet(); state.reader.goToChapter(i); }));
    }
  });
});

// Tìm trong sách
$('#btn-search').addEventListener('click', () => {
  if (!state.book) return;
  openSheet('Tìm trong sách', body => {
    const input = document.createElement('input');
    input.type = 'search'; input.placeholder = 'Nhập từ cần tìm (không dấu cũng được)…';
    body.appendChild(input);
    const list = document.createElement('div');
    body.appendChild(list);
    let run = 0;
    input.addEventListener('input', async () => {
      const q = input.value.trim();
      const my = ++run;
      list.innerHTML = '';
      if (q.length < 2) return;
      if (state.mode === 'pdf') {
        for (let p = 1; p <= state.reader.pageCount; p++) {
          if (my !== run) return;
          const txt = await state.reader.pageText(p);
          const hits = findAllFolded(txt, q, 3);
          for (const h of hits) {
            const snip = txt.slice(Math.max(0, h.start - 40), h.end + 60).replace(/\s+/g, ' ');
            row(list, `Trang ${p}`, '…' + snip + '…', () => { closeSheet(); state.reader.goToPage(p); });
          }
        }
        if (!list.children.length && my === run) list.innerHTML = '<p class="muted">Không tìm thấy.</p>';
      } else {
        state.chapters.forEach((c, i) => {
          const hits = findAllFolded(c.text || c.html?.replace(/<[^>]+>/g, ' ') || '', q, 3);
          for (const h of hits) {
            const plain = (c.text || '');
            const snip = plain.slice(Math.max(0, h.start - 40), h.end + 60);
            row(list, c.title || `Phần ${i + 1}`, '…' + snip + '…', () => { closeSheet(); state.reader.goToChapter(i); });
          }
        });
        if (!list.children.length) list.innerHTML = '<p class="muted">Không tìm thấy.</p>';
      }
    });
    setTimeout(() => input.focus(), 80);
  });
});

// Highlight + dấu trang
$('#btn-marks').addEventListener('click', () => {
  if (!state.book) return;
  openSheet('Highlight & Dấu trang', body => {
    const addBm = document.createElement('button');
    addBm.className = 'act primary wide';
    addBm.textContent = '🔖 Đánh dấu vị trí hiện tại';
    addBm.addEventListener('click', async () => {
      const loc = state.mode === 'pdf'
        ? { kind: 'pdf', page: state.reader.currentPage || 1, rects: [] }
        : { kind: 'flow', chapter: state.reader.currentChapter || 0 };
      const label = state.mode === 'pdf' ? `Trang ${loc.page}` : (state.chapters[loc.chapter]?.title || `Phần ${loc.chapter + 1}`);
      const bm = { id: uid(), bookId: state.book.id, label, locator: loc, createdAt: Date.now() };
      await Bookmarks.put(bm); state.bookmarks.push(bm);
      toast('Đã đánh dấu'); closeSheet();
    });
    body.appendChild(addBm);
    if (state.bookmarks.length) {
      const h = document.createElement('label'); h.textContent = 'Dấu trang'; body.appendChild(h);
      state.bookmarks.forEach(bm => {
        const r = row(body, '🔖 ' + bm.label, '', () => { closeSheet(); jumpTo(bm.locator, null); });
        const del = document.createElement('span'); del.className = 'del-link'; del.textContent = 'xoá';
        del.addEventListener('click', async e => { e.stopPropagation(); await Bookmarks.remove(bm.id); state.bookmarks = state.bookmarks.filter(x => x.id !== bm.id); r.remove(); });
        r.querySelector('.t').appendChild(del);
      });
    }
    const h2 = document.createElement('label'); h2.textContent = `Highlight (${state.highlights.length})`; body.appendChild(h2);
    if (!state.highlights.length) body.insertAdjacentHTML('beforeend', '<p class="muted">Chưa có highlight nào. Bôi đen một đoạn rồi chọn màu.</p>');
    state.highlights.forEach(hl => {
      const r = row(body, '', hl.note || '', () => { closeSheet(); jumpTo(hl.locator, hl.quote); });
      const t = r.querySelector('.t');
      const sw = document.createElement('mark'); sw.style.background = hl.color; sw.textContent = hl.quote.length > 90 ? hl.quote.slice(0, 90) + '…' : hl.quote;
      t.appendChild(sw);
      const del = document.createElement('span'); del.className = 'del-link'; del.textContent = 'xoá';
      del.addEventListener('click', async e => {
        e.stopPropagation();
        await Highlights.remove(hl.id);
        state.highlights = state.highlights.filter(x => x.id !== hl.id);
        state.reader.setHighlights(state.highlights);
        r.remove();
      });
      t.appendChild(del);
    });
  });
});

function jumpTo(locator, quote) {
  if (!locator) return;
  if (locator.kind === 'pdf' && locator.page) state.reader.goToPage(locator.page);
  else if (locator.kind === 'flow') state.reader.goToChapter(locator.chapter, quote);
}

// Tuỳ chỉnh đọc
$('#btn-aa').addEventListener('click', () => {
  openSheet('Tuỳ chỉnh đọc', body => {
    const font = +(localStorage.getItem('medreader.font') || 18);
    const theme = localStorage.getItem('medreader.theme') || 'dark';
    body.innerHTML = `
      <label>Cỡ chữ (EPUB / TXT / OCR): <b id="aa-font-val">${font}px</b></label>
      <input id="aa-font" type="range" min="14" max="28" step="1" value="${font}">
      <label>Nền đọc</label>
      <div class="chip-row" id="aa-themes">
        <button class="chip" data-theme="dark">Tối</button>
        <button class="chip" data-theme="paper">Giấy</button>
        <button class="chip" data-theme="light">Sáng</button>
      </div>
      <p class="muted" style="margin-top:14px">PDF giữ nguyên định dạng trang gốc (giống bản in).</p>`;
    body.querySelectorAll('#aa-themes .chip').forEach(c => {
      c.classList.toggle('active', c.dataset.theme === theme);
      c.addEventListener('click', () => {
        localStorage.setItem('medreader.theme', c.dataset.theme);
        applyReaderPrefs();
        body.querySelectorAll('#aa-themes .chip').forEach(x => x.classList.toggle('active', x === c));
      });
    });
    body.querySelector('#aa-font').addEventListener('input', e => {
      localStorage.setItem('medreader.font', e.target.value);
      body.querySelector('#aa-font-val').textContent = e.target.value + 'px';
      applyReaderPrefs();
    });
  });
});

// Cài đặt (Gemini key)
$('#btn-settings').addEventListener('click', () => {
  openSheet('Cài đặt', body => {
    body.innerHTML = `
      <label>Gemini API key (lưu trên máy này, không gửi đi nơi khác ngoài Google)</label>
      <input id="set-key" type="password" placeholder="Dán key Gemini của anh…" autocomplete="off">
      <label>Model Gemini</label>
      <input id="set-model" type="text">
      <button id="set-save" class="act primary wide" style="margin-top:16px">Lưu</button>
      <p class="muted" style="margin-top:12px">Chưa có key? Vào aistudio.google.com → Get API key → tạo key miễn phí, dán vào đây một lần là dịch được mãi.</p>`;
    body.querySelector('#set-key').value = getApiKey();
    body.querySelector('#set-model').value = getModel();
    body.querySelector('#set-save').addEventListener('click', () => {
      setApiKey(body.querySelector('#set-key').value);
      setModel(body.querySelector('#set-model').value);
      toast('Đã lưu cài đặt'); closeSheet();
    });
  });
});

// ================= OCR (PDF scan) =================
async function checkScanBanner(page) {
  if (state.mode !== 'pdf' || !state.book) return;
  const banner = $('#ocr-banner');
  let scanned = state.pdfScanned.get(page);
  if (scanned === undefined) {
    try { scanned = await state.reader.isScannedPage(page); } catch { scanned = false; }
    state.pdfScanned.set(page, scanned);
  }
  const ocrPages = await OcrStore.pages(state.book.id);
  $('#btn-ocr-open').hidden = ocrPages.length === 0;
  banner.hidden = !scanned && ocrPages.length === 0;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function ocrPage(page) {
  const img = await state.reader.pageImageBlob(page);
  const b64 = await blobToBase64(img);
  const res = await Bridge('ocrImage', { image: b64 });
  const lines = res?.lines || String(res?.text || '').split('\n');
  const paragraphs = mergeOcrLines(lines);
  const text = paragraphs.join('\n\n');
  await OcrStore.put(state.book.id, page, text);
  return text;
}

$('#btn-ocr-page').addEventListener('click', async () => {
  const page = state.reader.currentPage || 1;
  loading(true, `Đang OCR trang ${page}…`);
  try {
    await ocrPage(page);
    toast(`Đã OCR trang ${page} — bấm "Mở bản chữ OCR" để đọc/dịch`);
    checkScanBanner(page);
  } catch (e) { toast(`OCR lỗi: ${e.message || e}`, 4500); }
  finally { loading(false); }
});

$('#btn-ocr-all').addEventListener('click', async () => {
  const total = state.reader.pageCount;
  try {
    for (let p = 1; p <= total; p++) {
      const existing = await OcrStore.get(state.book.id, p);
      if (existing) continue;
      let scanned = state.pdfScanned.get(p);
      if (scanned === undefined) { scanned = await state.reader.isScannedPage(p); state.pdfScanned.set(p, scanned); }
      if (!scanned) continue;
      loading(true, `Đang OCR trang ${p}/${total}…`);
      await ocrPage(p);
    }
    toast('OCR xong — bấm "Mở bản chữ OCR" để đọc/dịch');
    checkScanBanner(state.reader.currentPage || 1);
  } catch (e) { toast(`OCR lỗi: ${e.message || e}`, 4500); }
  finally { loading(false); }
});

$('#btn-ocr-open').addEventListener('click', async () => {
  if (!state.book) return;
  loading(true, 'Đang mở bản chữ OCR…');
  try {
    const total = state.book.pageCount || 0;
    const chapters = [];
    for (let p = 1; p <= total; p++) {
      let text = await OcrStore.get(state.book.id, p);
      if (!text) {
        // Trang có lớp chữ thì dùng luôn lớp chữ
        try { const t = await state.reader.pageText(p); if (t && t.replace(/\s/g, '').length >= 24) text = t; } catch {}
      }
      chapters.push({ title: `Trang ${p}`, text: text || '(Trang này chưa OCR — quay lại bản PDF và bấm "OCR cả sách".)' });
    }
    state.reader?.destroy?.();
    state.mode = 'ocr';
    state.chapters = chapters;
    const scroll = $('#reader-scroll');
    scroll.innerHTML = '';
    scroll.className = 'reader-scroll flow';
    const reader = new FlowReader(scroll, { onChapterChange: ch => updateFlowPos(ch) });
    state.reader = reader;
    reader.load(chapters);
    // Highlight ở bản OCR dùng locator flow riêng (kind 'flow', chapter = trang-1)
    reader.setHighlights(state.highlights);
    applyReaderPrefs();
    $('#ocr-banner').hidden = true;
    updateFlowPos(0);
    toast('Đang xem bản chữ OCR — bôi đen để dịch/highlight như sách thường');
  } catch (e) { toast(`Mở bản OCR lỗi: ${e.message || e}`, 4500); }
  finally { loading(false); }
});

// ================= ĐIỀU HƯỚNG + KHỞI TẠO =================
$('#btn-back').addEventListener('click', () => {
  if (state.mode === 'ocr' && state.book) { const id = state.book.id; state.mode = null; openBook(id); }
  else closeBook();
});
$('#btn-add').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', e => {
  if (e.target.files?.length) importFiles([...e.target.files]);
  e.target.value = '';
});
$('#lib-search').addEventListener('input', renderLibrary);
$('#lib-sort').addEventListener('change', renderLibrary);

renderLibrary();
