// MedGloss-style gloss: Gemini chẻ câu tiếng Anh thành cụm 3–5 từ và cho
// nghĩa tiếng Việt từng cụm; app hiển thị nghĩa trong ngoặc đơn ngay sau cụm.
// Module thuần (không DOM) để test bằng node.

export const GLOSS_SYSTEM = `You are a medical English–Vietnamese glossing engine.
Split the user's English text into consecutive phrases of 3–5 words each (keep medical terms and fixed collocations together; the last phrase may be shorter).
For each phrase, give a concise Vietnamese gloss (medical meaning, not word-by-word).
Return ONLY JSON: {"phrases":[{"src":"...","vi":"..."}]}
The "src" values, joined by single spaces, must reproduce the input text exactly (same words, same order, keep punctuation attached to its word).`;

export function buildGlossPrompt(text) {
  return `${GLOSS_SYSTEM}\n\nText:\n${text}`;
}

// Parse đáp án Gemini -> [{src, vi}] hoặc null nếu hỏng.
export function parseGloss(raw, original) {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  const list = Array.isArray(obj) ? obj : obj.phrases;
  if (!Array.isArray(list) || !list.length) return null;
  const phrases = list
    .filter(p => p && typeof p.src === 'string' && typeof p.vi === 'string' && p.src.trim())
    .map(p => ({ src: p.src, vi: p.vi.trim() }));
  if (!phrases.length) return null;
  // Kiểm chứng: ghép src lại phải khớp text gốc (chuẩn hoá khoảng trắng).
  if (original) {
    const norm = t => t.replace(/\s+/g, ' ').trim();
    if (norm(phrases.map(p => p.src).join(' ')) !== norm(original)) return null;
  }
  return phrases;
}

const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTML hiển thị: cụm gốc + (nghĩa teal đậm) — đúng format MedGloss.
export function glossToHtml(phrases) {
  return phrases.map(p => `${esc(p.src)} <span class="gloss-vi">(${esc(p.vi)})</span>`).join(' ');
}
