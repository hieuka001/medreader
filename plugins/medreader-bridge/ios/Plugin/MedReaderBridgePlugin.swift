import Foundation
import Capacitor
import Vision
import UIKit

@objc(MedReaderBridgePlugin)
public class MedReaderBridgePlugin: CAPPlugin {

    @objc func getInfo(_ call: CAPPluginCall) {
        call.resolve(["platform": "ios", "version": "1.0.0"])
    }

    // OCR một ảnh trang sách bằng Apple Vision — offline, tiếng Việt cần iOS 16+.
    // Input: { image: base64 PNG/JPEG } -> { lines: [String], text: String }
    @objc func ocrImage(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"),
              let data = Data(base64Encoded: b64),
              let image = UIImage(data: data),
              let cg = image.cgImage else {
            call.reject("Ảnh trang sách không hợp lệ"); return
        }
        guard #available(iOS 16.0, *) else {
            call.reject("OCR tiếng Việt cần iOS 16 trở lên — máy đang chạy iOS cũ hơn."); return
        }
        do {
            let langs = try VNRecognizeTextRequest.supportedRecognitionLanguages(for: .accurate, revision: VNRecognizeTextRequestRevision3)
            guard langs.contains(where: { $0.hasPrefix("vi") }) else {
                call.reject("Thiết bị chưa hỗ trợ OCR tiếng Việt."); return
            }
        } catch {
            call.reject("Không kiểm tra được ngôn ngữ OCR: \(error.localizedDescription)"); return
        }
        let request = VNRecognizeTextRequest { (req, err) in
            if let err { call.reject("OCR lỗi: \(err.localizedDescription)"); return }
            let lines = (req.results as? [VNRecognizedTextObservation] ?? [])
                .compactMap { $0.topCandidates(1).first?.string }
            call.resolve(["lines": lines, "text": lines.joined(separator: "\n")])
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["vi-VN", "en-US"]
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do { try handler.perform([request]) }
            catch { call.reject("OCR lỗi: \(error.localizedDescription)") }
        }
    }
}
