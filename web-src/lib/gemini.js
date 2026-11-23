// Gọi Gemini bằng key của người dùng (lưu local, giống MedGloss).
// Xoay model khi model chính lỗi/không có quyền — bài học Chronos AI:
// gemini-2.5-* không còn cho tài khoản mới, nên mặc định 3.8-flash.
import { buildGlossPrompt, parseGloss } from './gloss.js';

export const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-flash-lite-latest'];
const LS_KEY = 'medreader.geminiKey';
const LS_MODEL = 'medreader.geminiModel';

export const getApiKey = () => localStorage.getItem(LS_KEY) || '';
export const setApiKey = k => { if (k) localStorage.setItem(LS_KEY, k.trim()); else localStorage.removeItem(LS_KEY); };
export const getModel = () => localStorage.getItem(LS_MODEL) || DEFAULT_MODELS[0];
export const setModel = m => { if (m) localStorage.setItem(LS_MODEL, m.trim()); };

async function callOnce(model, key, prompt, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error?.message) msg = j.error.message; } catch {}
      const e = new Error(msg); e.status = res.status; throw e;
    }
    const j = await res.json();
    const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!text) throw new Error('Gemini trả về rỗng');
    return text;
  } finally { clearTimeout(t); }
}

export async function callGemini(prompt) {
  const key = getApiKey();
  if (!key) throw new Error('Chưa có Gemini API key — vào Cài đặt trong app để dán key một lần.');
  const models = [getModel(), ...DEFAULT_MODELS.filter(m => m !== getModel())];
  let lastErr;
  for (const m of models) {
    try { return await callOnce(m, key, prompt); }
    catch (e) { lastErr = e; if (e.status === 400 && /API key/i.test(e.message)) break; }
  }
  throw lastErr || new Error('Không gọi được Gemini');
}

// Dịch cụm (gloss) — trả [{src, vi}] hoặc ném lỗi.
export async function translateGloss(text) {
  const raw = await callGemini(buildGlossPrompt(text));
  const phrases = parseGloss(raw, text);
  if (!phrases) throw new Error('Gemini trả gloss không đúng định dạng, thử lại.');
  return phrases;
}

// Dịch trọn đoạn — văn xuôi tiếng Việt thuần.
export async function translateFull(text) {
  const prompt = `Translate the following text into natural Vietnamese. If it is medical text, use correct Vietnamese medical terminology. Return ONLY the translation, no explanations.\n\n${text}`;
  return (await callGemini(prompt)).trim();
}
