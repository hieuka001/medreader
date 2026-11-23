// Tiện ích OCR thuần: gộp dòng OCR thành đoạn/câu và nhận diện trang scan.
// Rút kinh nghiệm Sách Nói Offline 1.1.1: dấu ':' và ';' KHÔNG kết thúc câu
// ("Lão Tử nói:" + câu sau là một câu), chỉ . ! ? … mới kết thúc.

// Một trang PDF có ít hơn ngưỡng ký tự này (sau khi bỏ khoảng trắng) thì
// coi là trang scan / không có lớp chữ dùng được.
export const SCAN_CHAR_THRESHOLD = 24;

export function isScannedText(text) {
  return String(text || '').replace(/\s/g, '').length < SCAN_CHAR_THRESHOLD;
}

const SENTENCE_END = /[.!?…]$/;
const LINE_END_OK = /[.!?…)"”’»]$/;

// Gộp các dòng OCR (theo thứ tự đọc) thành đoạn văn: dòng kết thúc bằng
// dấu gạch nối thì nối không khoảng trắng; hết đoạn khi dòng trống hoặc
// dòng trước kết thúc câu và dòng sau viết hoa/mở đầu số mục.
export function mergeOcrLines(lines) {
  const paragraphs = [];
  let cur = '';
  const flush = () => { if (cur.trim()) paragraphs.push(cur.trim()); cur = ''; };
  for (const raw of lines || []) {
    const line = String(raw || '').trim();
    if (!line) { flush(); continue; }
    if (!cur) { cur = line; continue; }
    if (cur.endsWith('-')) { cur = cur.slice(0, -1) + line; continue; }
    // Dòng mới bắt đầu một đoạn khi câu trước đã kết thúc rõ ràng và
    // dòng này trông như mở đầu mới (viết hoa / số thứ tự / dấu mục).
    const newPara = LINE_END_OK.test(cur) && /^[A-ZÀ-Ỹ0-9§•\-–—"“'(]/.test(line);
    if (newPara) { flush(); cur = line; }
    else cur += ' ' + line;
  }
  flush();
  return paragraphs;
}

// Tách đoạn thành câu (cho tìm kiếm/highlight theo câu khi cần).
export function splitSentences(text) {
  const out = [];
  const re = /[^.!?…]+[.!?…]+["”’»)]*\s*|[^.!?…]+$/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

export { SENTENCE_END };
