import Foundation
import UIKit
import WebKit

/// 客户端诊断：把启动阶段、JS 错误、WebView 失败和安装包/OTA 状态落到本机，
/// 再尽力上传到家中服务器 `/api/clientlog`。上传失败不丢日志，下次启动重试。
/// 原生层独立工作，即使 Pyodide/页面起不来也能记录。
final class ClientLogger: NSObject, WKScriptMessageHandler {
    static let shared = ClientLogger()
    static let bootFailure = Notification.Name("manorBootFailure")
    static let bootReady = Notification.Name("manorBootReady")
    static let failureMessageKey = "message"

    private let fm = FileManager.default
    private let queue = DispatchQueue(label: "manor.client.logger")
    private let session: URLSession
    private let baseDir: URL
    private let logFile: URL
    private weak var webView: WKWebView?
    private var events: [[String: Any]] = []
    private var currentStage = "native"
    private var warnCount = 0
    private var uploading = false
    private var pendingUpload = false
    private var ready = false
    private let maxEvents = 240

    private override init() {
        let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.temporaryDirectory
        baseDir = support.appendingPathComponent("ManorLogs", isDirectory: true)
        logFile = baseDir.appendingPathComponent("diagnostics.json")
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
        super.init()
        try? FileManager.default.createDirectory(at: baseDir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = baseDir
        try? mutable.setResourceValues(values)
        loadEvents()
    }

    // MARK: - lifecycle

    func bind(webView: WKWebView) {
        self.webView = webView
    }

    func beginSession() {
        record("app.launch", detail: [
            "version": appVersion,
            "build": appBuild,
            "webVersion": OtaStore().bundledVersion(),
            "activeVersion": OtaStore().usedActiveVersion() ?? "",
        ])
    }

    var userScript: WKUserScript {
        WKUserScript(
            source: Self.injectedScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    func stage(_ name: String, detail: [String: Any] = [:]) {
        currentStage = name
        record("boot.stage", detail: ["stage": name].merging(detail) { _, new in new })
    }

    func resetReady() {
        ready = false
        warnCount = 0
    }

    func markReady() {
        ready = true
        currentStage = "ready"
        record("boot.ready", detail: ["version": appVersion, "webVersion": OtaStore().bundledVersion()])
        notify(.bootReady, message: nil)
        upload(reason: "boot.ready")
    }

    func recordBootError(_ message: String, detail: [String: Any] = [:]) {
        var merged = detail
        merged["message"] = message
        merged["stage"] = currentStage
        record("boot.error", level: "error", detail: merged)
        notify(.bootFailure, message: message)
        upload(reason: "bootError")
    }

    func record(_ event: String, level: String = "info", detail: [String: Any] = [:]) {
        print("MANOR diag [\(level)] \(event) \(detail)")
        queue.async {
            var item: [String: Any] = [
                "at": Self.timestamp(),
                "event": event,
                "level": level,
            ]
            if !detail.isEmpty {
                item["detail"] = Self.jsonSafe(detail)
            }
            self.events.append(item)
            if self.events.count > self.maxEvents {
                self.events.removeFirst(self.events.count - self.maxEvents)
            }
            self.persistLocked()
        }
    }

    func flush() {
        upload(reason: "manual")
    }

    // MARK: - JS bridge

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "stage":
            let name = String(describing: body["stage"] ?? "unknown")
            let version = String(describing: body["webVersion"] ?? "")
            stage(name, detail: ["webVersion": version])
        case "log":
            let level = String(describing: body["level"] ?? "info")
            if level == "warn" {
                let allowed = queue.sync { () -> Bool in
                    warnCount += 1
                    return warnCount <= 80
                }
                guard allowed else { return }
            }
            let event = String(describing: body["event"] ?? "js.log")
            var detail = (body["detail"] as? [String: Any]) ?? [:]
            if let message = body["message"] as? String {
                detail["message"] = String(message.prefix(2000))
            }
            record(event, level: level, detail: detail)
        case "bootError":
            let message = String(describing: body["message"] ?? "未知启动错误")
            var detail = (body["detail"] as? [String: Any]) ?? [:]
            if let stack = body["stack"] as? String {
                detail["stack"] = String(stack.prefix(4000))
            }
            recordBootError(String(message.prefix(2000)), detail: detail)
        case "ready":
            markReady()
        default:
            break
        }
    }

    // MARK: - upload

    func upload(reason: String) {
        queue.async {
            guard !self.uploading else {
                self.pendingUpload = true
                return
            }
            self.uploading = true
            let payload = self.payloadLocked(reason: reason)
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload) else {
                self.uploading = false
                return
            }
            let url = HomeServer.url.appendingPathComponent("api/clientlog")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 15
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.httpBody = data
            self.session.dataTask(with: request) { data, response, error in
                self.queue.async {
                    self.uploading = false
                    if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                        print("MANOR diag uploaded id=\(String(data: data ?? Data(), encoding: .utf8) ?? "")")
                        self.events.removeAll(keepingCapacity: true)
                        self.persistLocked()
                    } else if let error {
                        print("MANOR diag upload failed: \(error.localizedDescription)")
                    }
                    if self.pendingUpload {
                        self.pendingUpload = false
                        let delay = DispatchTime.now() + 1.0
                        DispatchQueue.main.asyncAfter(deadline: delay) {
                            self.upload(reason: "retry")
                        }
                    }
                }
            }.resume()
        }
    }

    private func payloadLocked(reason: String) -> [String: Any] {
        let store = OtaStore()
        let state = store.readState()
        let deviceID = UserDefaults.standard.string(forKey: "manor.deviceID") ?? {
            let id = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
            UserDefaults.standard.set(id, forKey: "manor.deviceID")
            return id
        }()
        var device: [String: Any] = [
            "id": deviceID,
            "name": UIDevice.current.name,
            "model": UIDevice.current.model,
            "system": "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
            "locale": Locale.current.identifier,
            "physicalMemory": ProcessInfo.processInfo.physicalMemory,
        ]
        if let free = freeDiskBytes() { device["freeDisk"] = free }
        var ota: [String: Any] = [
            "bundled": store.bundledVersion(),
            "effective": store.effectiveVersion(),
            "active": store.usedActiveVersion() ?? "",
            "rejected": state.rejectedVersion ?? "",
            "server": HomeServer.url.absoluteString,
        ]
        if let root = store.activeRoot() {
            ota["activeRoot"] = root.lastPathComponent
        }
        let payload: [String: Any] = [
            "schema": 1,
            "reason": reason,
            "source": "ios-native",
            "sentAt": Self.timestamp(),
            "device": device,
            "app": [
                "version": appVersion,
                "build": appBuild,
                "bundle": Bundle.main.bundleIdentifier ?? "",
            ],
            "web": [
                "version": OtaStore().bundledVersion(),
                "stage": currentStage,
            ],
            "ota": ota,
            "bundleFiles": bundleChecks(),
            "events": events,
        ]
        return payload
    }

    private func bundleChecks() -> [String: Any] {
        var result: [String: Any] = [:]
        let root = Bundle.main.url(forResource: "WebAssets", withExtension: nil)
        result["webAssets"] = root?.path ?? "missing"
        let rels = [
            "index.html", "app-core.zip", "models.zip",
            "static/boot.js", "web-version.json",
            "pyodide/pyodide.js", "pyodide/pyodide.asm.wasm",
        ]
        if let root {
            for rel in rels {
                let url = root.appendingPathComponent(rel)
                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1
                result[rel] = size
            }
            if let packages = try? fm.contentsOfDirectory(
                at: root.appendingPathComponent("packages"),
                includingPropertiesForKeys: [.fileSizeKey]
            ) {
                result["packages"] = packages.map { "\($0.lastPathComponent):\((try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1)" }
            }
        }
        if let overlay = OtaStore().activeRoot() {
            result["overlay"] = overlay.path
            result["overlayFiles"] = (try? fm.contentsOfDirectory(atPath: overlay.path)) ?? []
        }
        return result
    }

    private func freeDiskBytes() -> Int64? {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    }

    private var appBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
    }

    // MARK: - persistence

    private func loadEvents() {
        if let data = try? Data(contentsOf: logFile),
           let object = try? JSONSerialization.jsonObject(with: data),
           let rows = object as? [[String: Any]] {
            events = rows
        }
        record("logger.ready", detail: ["version": appVersion, "build": appBuild])
    }

    private func persistLocked() {
        do {
            try fm.createDirectory(at: baseDir, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: events, options: [])
            try data.write(to: logFile, options: .atomic)
        } catch {
            print("MANOR diag persist failed: \(error.localizedDescription)")
        }
    }

    private func notify(_ name: Notification.Name, message: String?) {
        DispatchQueue.main.async {
            var info: [String: Any] = [:]
            if let message { info[Self.failureMessageKey] = message }
            NotificationCenter.default.post(name: name, object: nil, userInfo: info)
        }
    }

    private static func timestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private static func jsonSafe(_ value: Any) -> Any {
        if let string = value as? String { return String(string.prefix(4000)) }
        if let number = value as? NSNumber { return number }
        if let bool = value as? Bool { return bool }
        if let dict = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (k, v) in dict.prefix(40) { out[String(k.prefix(80))] = jsonSafe(v) }
            return out
        }
        if let array = value as? [Any] {
            return array.prefix(60).map { jsonSafe($0) }
        }
        return String(String(describing: value).prefix(2000))
    }

    private static let injectedScript = """
    (function () {
      if (window.__manorDiagInstalled) return;
      window.__manorDiagInstalled = true;
      function post(payload) {
        try { window.webkit.messageHandlers.manorDiag.postMessage(payload); } catch (e) {}
      }
      function text(value) {
        try {
          if (typeof value === 'string') return value.slice(0, 2000);
          return JSON.stringify(value).slice(0, 2000);
        } catch (e) { return String(value).slice(0, 2000); }
      }
      window.__manorNativeLog = function (level, event, detail) {
        post({ action: 'log', level: String(level || 'info'), event: String(event || 'js.log'), detail: detail || {} });
      };
      window.addEventListener('error', function (event) {
        post({ action: 'log', level: 'error', event: 'window.error',
          message: text(event.message || ''),
          detail: { source: text(event.filename || ''), line: event.lineno || 0, col: event.colno || 0,
                    stack: text(event.error && event.error.stack ? event.error.stack : '') } });
      });
      window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        post({ action: 'log', level: 'error', event: 'unhandledrejection',
          message: text(reason && reason.message ? reason.message : reason),
          detail: { stack: text(reason && reason.stack ? reason.stack : '') } });
      });
      var originalError = console.error;
      console.error = function () {
        post({ action: 'log', level: 'error', event: 'console.error',
          message: Array.prototype.map.call(arguments, text).join(' ').slice(0, 2000) });
        return originalError.apply(console, arguments);
      };
      var originalWarn = console.warn;
      console.warn = function () {
        post({ action: 'log', level: 'warn', event: 'console.warn',
          message: Array.prototype.map.call(arguments, text).join(' ').slice(0, 2000) });
        return originalWarn.apply(console, arguments);
      };
    })();
    """
}
