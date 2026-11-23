// IndexedDB: thư viện sách + highlight + bookmark + trang OCR.
// books: {id, title, author, format: 'pdf'|'epub'|'txt', size, addedAt,
//         progress: {...}, cover: Blob|null, pageCount?, chapterCount?}
//   file gốc để ở store 'files' theo id (tách khỏi meta cho nhẹ).
// highlights: {id, bookId, color, quote, note, locator, createdAt}
// bookmarks: {id, bookId, label, locator, createdAt}
// ocr: {bookId, page, text} (key [bookId, page])

const DB_NAME = 'medreader';
const DB_VER = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('files', { keyPath: 'id' });
      const h = db.createObjectStore('highlights', { keyPath: 'id' });
      h.createIndex('bookId', 'bookId');
      const b = db.createObjectStore('bookmarks', { keyPath: 'id' });
      b.createIndex('bookId', 'bookId');
      db.createObjectStore('ocr', { keyPath: ['bookId', 'page'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  }));
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const Books = {
  async all() { return tx('books', 'readonly', s => reqP(s.getAll())); },
  async get(id) { return tx('books', 'readonly', s => reqP(s.get(id))); },
  async put(book) { return tx('books', 'readwrite', s => reqP(s.put(book))); },
  async remove(id) {
    await tx('books', 'readwrite', s => reqP(s.delete(id)));
    await tx('files', 'readwrite', s => reqP(s.delete(id)));
  },
  async putFile(id, blob) { return tx('files', 'readwrite', s => reqP(s.put({ id, blob }))); },
  async getFile(id) { const r = await tx('files', 'readonly', s => reqP(s.get(id))); return r?.blob || null; },
};

export const Highlights = {
  async forBook(bookId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out = [];
      const t = db.transaction('highlights', 'readonly');
      const idx = t.objectStore('highlights').index('bookId');
      const cur = idx.openCursor(IDBKeyRange.only(bookId));
      cur.onsuccess = () => { const c = cur.result; if (c) { out.push(c.value); c.continue(); } else resolve(out.sort((a, b) => a.createdAt - b.createdAt)); };
      cur.onerror = () => reject(cur.error);
    });
  },
  async put(h) { return tx('highlights', 'readwrite', s => reqP(s.put(h))); },
  async remove(id) { return tx('highlights', 'readwrite', s => reqP(s.delete(id))); },
};

export const Bookmarks = {
  async forBook(bookId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out = [];
      const t = db.transaction('bookmarks', 'readonly');
      const idx = t.objectStore('bookmarks').index('bookId');
      const cur = idx.openCursor(IDBKeyRange.only(bookId));
      cur.onsuccess = () => { const c = cur.result; if (c) { out.push(c.value); c.continue(); } else resolve(out.sort((a, b) => a.createdAt - b.createdAt)); };
      cur.onerror = () => reject(cur.error);
    });
  },
  async put(b) { return tx('bookmarks', 'readwrite', s => reqP(s.put(b))); },
  async remove(id) { return tx('bookmarks', 'readwrite', s => reqP(s.delete(id))); },
};

export const OcrStore = {
  async get(bookId, page) { const r = await tx('ocr', 'readonly', s => reqP(s.get([bookId, page]))); return r?.text || null; },
  async put(bookId, page, text) { return tx('ocr', 'readwrite', s => reqP(s.put({ bookId, page, text }))); },
  async pages(bookId) {
    const all = await tx('ocr', 'readonly', s => reqP(s.getAll()));
    return (all || []).filter(r => r.bookId === bookId).map(r => r.page).sort((a, b) => a - b);
  },
};
