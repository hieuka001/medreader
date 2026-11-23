import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGloss, glossToHtml } from '../web-src/lib/gloss.js';
import { findQuote, findAllFolded, foldText } from '../web-src/lib/textfind.js';
import { isScannedText, mergeOcrLines, splitSentences, SCAN_CHAR_THRESHOLD } from '../web-src/lib/ocrutil.js';

test('gloss: parse JSON thuần', () => {
  const raw = '{"phrases":[{"src":"The flexor tendon","vi":"gân gấp"},{"src":"is repaired","vi":"được khâu nối"}]}';
  const p = parseGloss(raw, 'The flexor tendon is repaired');
  assert.equal(p.length, 2);
  assert.equal(p[0].vi, 'gân gấp');
});

test('gloss: parse JSON trong code fence', () => {
  const raw = '```json\n{"phrases":[{"src":"Hello world","vi":"xin chào"}]}\n```';
  assert.equal(parseGloss(raw, 'Hello world').length, 1);
});

test('gloss: ghép src không khớp gốc -> null', () => {
  const raw = '{"phrases":[{"src":"Something else","vi":"x"}]}';
  assert.equal(parseGloss(raw, 'The flexor tendon'), null);
});

test('gloss: HTML escape + format ngoặc teal', () => {
  const html = glossToHtml([{ src: 'a <b> c', vi: 'nghĩa' }]);
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('<span class="gloss-vi">(nghĩa)</span>'));
});

test('textfind: findQuote chịu khác khoảng trắng/xuống dòng', () => {
  const text = 'The  flexor\ntendon is   repaired today.';
  const hit = findQuote(text, 'The flexor tendon is repaired');
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end).replace(/\s+/g, ' '), 'The flexor tendon is repaired');
});

test('textfind: hint chọn đúng occurrence gần nhất', () => {
  const text = 'cat dog cat bird cat';
  const hit = findQuote(text, 'cat', 12);
  assert.equal(hit.start, 8); // occurrence ở 8 gần hint 12 hơn occurrence ở 17
});

test('textfind: findAllFolded không dấu tiếng Việt', () => {
  const hits = findAllFolded('Gân gấp và gân duỗi, GÂN GẤP', 'gan gap');
  assert.equal(hits.length, 2);
  assert.equal(foldText('Đường'), 'duong');
});

test('ocr: isScannedText theo ngưỡng', () => {
  assert.equal(isScannedText('ít chữ'), true);
  assert.equal(isScannedText('x'.repeat(SCAN_CHAR_THRESHOLD + 5)), false);
  assert.equal(isScannedText(''), true);
});

test('ocr: mergeOcrLines nối gạch nối + không tách câu ở dấu hai chấm', () => {
  const paras = mergeOcrLines(['The flexor ten-', 'don is repaired.', 'He said:', 'the result was good.']);
  assert.equal(paras[0], 'The flexor tendon is repaired.');
  assert.equal(paras[1], 'He said: the result was good.');
});

test('ocr: splitSentences cơ bản', () => {
  const s = splitSentences('Câu một. Câu hai! Câu ba chưa hết');
  assert.equal(s.length, 3);
});
