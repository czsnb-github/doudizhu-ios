import Foundation

/// 家中电脑正式服地址。iOS 端用它做两件可选的事：OTA 更新、档案同步。
/// 连不上时完全退回本机数据，不影响单机/蓝牙牌局。
enum HomeServer {
    static let key = "manor.serverURL"
    static let defaultURL = URL(string: "http://192.168.31.182:8000/")!

    static var url: URL {
        if let text = UserDefaults.standard.string(forKey: key),
           let parsed = normalized(text) {
            return parsed
        }
        return defaultURL
    }

    static func save(_ url: URL) {
        UserDefaults.standard.set(url.absoluteString, forKey: key)
    }

    static func normalized(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let lower = text.lowercased()
        if lower.contains("://"), !lower.hasPrefix("http://"), !lower.hasPrefix("https://") {
            return nil
        }
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") {
            text = "http://" + text
        }
        guard var components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host != nil else { return nil }
        components.query = nil
        components.fragment = nil
        if !components.path.hasSuffix("/") {
            components.path += "/"
        }
        if components.path.split(separator: "/").contains("..") { return nil }
        return components.url
    }

    static func otaBaseURL(from server: URL? = nil) -> URL {
        (server ?? url).appendingPathComponent("static/ota/ios", isDirectory: true)
    }
}
