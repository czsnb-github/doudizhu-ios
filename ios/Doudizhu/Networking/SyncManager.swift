import Foundation
import WebKit

/// 可选的家庭服务器档案同步。端侧永远是主数据；能连上就把两边合并。
/// 只同步玩家档案，对局牌谱留在各自设备上。
final class SyncManager: NSObject, WKScriptMessageHandler {
    static let shared = SyncManager()

    private static let lastSyncKey = "manor.lastProfileSync"
    private let session: URLSession
    private weak var webView: WKWebView?
    private var syncing = false
    private var lastSync: Date?

    override init() {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
        if let saved = UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date {
            lastSync = saved
        }
        super.init()
    }

    func bind(webView: WKWebView) {
        self.webView = webView
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "status":
            emitStatus()
        case "sync":
            let auto = (body["auto"] as? Bool) ?? false
            guard let payload = body["payload"] as? [String: Any] else {
                emit(["type": "error", "quiet": auto, "message": "本机档案格式不对"])
                return
            }
            sync(payload: payload, auto: auto)
        default:
            break
        }
    }

    private func sync(payload: [String: Any], auto: Bool) {
        if syncing {
            emitStatus()
            return
        }
        let players = payload["players"] as? [[String: Any]] ?? []
        guard !players.isEmpty else {
            emit(["type": "noLocal", "quiet": auto])
            return
        }
        syncing = true
        emit(["type": "syncing", "quiet": auto])
        let url = HomeServer.url.appendingPathComponent("api/sync/data")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            syncing = false
            emit(["type": "error", "quiet": auto, "message": "档案序列化失败"])
            return
        }
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            do {
                let (data, response) = try await self.session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw OtaError.badResponse }
                guard http.statusCode == 200 else { throw OtaError.http(http.statusCode) }
                guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let merged = object["players"] as? [[String: Any]] else {
                    throw OtaError.badResponse
                }
                self.finishSuccess(response: object, players: merged)
            } catch {
                self.finishFailure(error, auto: auto)
            }
        }
    }

    private func finishSuccess(response: [String: Any], players: [[String: Any]]) {
        DispatchQueue.main.async {
            self.syncing = false
            let now = Date()
            self.lastSync = now
            UserDefaults.standard.set(now, forKey: Self.lastSyncKey)
            self.emit([
                "type": "done",
                "count": players.count,
                "historyAdded": (response["history_added"] as? Int) ?? 0,
                "payload": response,
            ])
            self.emitStatus()
        }
    }

    private func finishFailure(_ error: Error, auto: Bool) {
        DispatchQueue.main.async {
            self.syncing = false
            self.emit([
                "type": "error",
                "quiet": auto,
                "message": error.localizedDescription,
            ])
            self.emitStatus()
        }
    }

    private func emitStatus() {
        var payload: [String: Any] = [
            "type": "status",
            "baseURL": HomeServer.url.absoluteString,
            "syncing": syncing,
        ]
        if let lastSync {
            let formatter = DateFormatter()
            formatter.dateFormat = "MM-dd HH:mm"
            payload["lastSync"] = formatter.string(from: lastSync)
        }
        emit(payload)
    }

    private func emit(_ payload: [String: Any]) {
        DispatchQueue.main.async {
            guard let webView = self.webView,
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript(
                "window.manorSyncEvent && window.manorSyncEvent(\(json));",
                completionHandler: nil
            )
        }
    }
}
