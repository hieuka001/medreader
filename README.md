# MedReader — Đọc sách & Dịch Gemini (iOS)

App đọc sách iOS (cài qua ESign, bản unsigned) gồm:

- **Thư viện**: nhập PDF / EPUB / TXT từ máy, bìa sách, tiến độ đọc, tìm + sắp xếp.
- **Đọc PDF**: pdf.js có lớp chữ — bôi đen được như sách thật; mục lục theo outline.
- **Đọc EPUB/TXT**: trình đọc chảy, chỉnh cỡ chữ + nền (Tối/Giấy/Sáng).
- **Bôi đen → hành động**: Dịch cụm Gemini (kiểu MedGloss: chẻ cụm 3–5 từ, nghĩa tiếng Việt teal đậm trong ngoặc), Dịch trọn câu, Highlight 5 màu, Ghi chú, Nghe (giọng máy), Sao chép.
- **Bong bóng dịch** 💬: dịch đoạn đang chọn hoặc dán câu bất kỳ.
- **Highlight / ghi chú / dấu trang**: danh sách theo sách, bấm để nhảy tới đúng vị trí.
- **Tìm trong sách**: không dấu cũng tìm được.
- **OCR sách scan**: phát hiện trang không có lớp chữ → OCR bằng Apple Vision ngay trên máy (offline, tiếng Việt cần iOS 16+) → mở "bản chữ OCR" để đọc/bôi đen/dịch/highlight như sách thường.
- **Cài đặt**: dán Gemini API key một lần (lưu trên máy), chọn model.

Kiến trúc: Capacitor 6 + web local đóng kèm trong IPA (không nạp web từ xa) + plugin native `medreader-bridge` (OCR Vision). Sách và dữ liệu đọc lưu IndexedDB trên máy.
