// Tìm vị trí của một đoạn trích (quote) trong văn bản — dùng để gắn lại
// highlight cho EPUB/TXT/OCR (không có toạ độ cố định như PDF).
// Thuần, test bằng node.

// Bỏ dấu tiếng Việt để tìm kiếm không dấu.
export function foldText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

// Chuẩn hoá khoảng trắng, giữ bản đồ vị trí về text gốc.
function normalizeWithMap(text) {
  let norm = '';
  const map = []; // map[i] = vị trí trong text gốc của ký tự norm[i]
  let prevSpace = true; // cắt khoảng trắng đầu
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) { norm += ' '; map.push(i); prevSpace = true; }
    } else { norm += ch; map.push(i); prevSpace = false; }
  }
  if (norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
  return { norm, map };
}

// Trả {start, end} (offset trong text gốc, end exclusive) hoặc null.
export function findQuote(text, quote, hintStart = -1) {
  if (!text || !quote) return null;
  const { norm, map } = normalizeWithMap(text);
  const q = quote.replace(/\s+/g, ' ').trim();
  if (!q) return null;
  let idx = -1;
  if (hintStart >= 0) {
    // Tìm occurrence gần hint nhất
    let best = -1, bestDist = Infinity, from = 0;
    while (true) {
      const i = norm.indexOf(q, from);
      if (i < 0) break;
      const d = Math.abs(map[i] - hintStart);
      if (d < bestDist) { bestDist = d; best = i; }
      from = i + 1;
    }
    idx = best;
  } else {
    idx = norm.indexOf(q);
  }
  if (idx < 0) return null;
  const start = map[idx];
  const lastNorm = idx + q.length - 1;
  const end = map[lastNorm] + 1;
  return { start, end };
}

// Tìm mọi vị trí khớp cho tìm-trong-sách (không dấu, không phân biệt hoa thường).
export function findAllFolded(text, query, limit = 200) {
  const out = [];
  if (!text || !query) return out;
  const hay = foldText(text);
  const needle = foldText(query).trim();
  if (!needle) return out;
  let from = 0;
  while (out.length < limit) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push({ start: i, end: i + needle.length });
    from = i + 1;
  }
  return out;
}
