import Foundation

/// 一版最小协议：一行一个 JSON，以 `\n` 结尾。
/// 原生客户端之间先跑通网络层，牌局消息后续在同一结构上扩展。
struct WireMessage: Codable {
    var type: String
    var name: String?
    var role: String?
    var names: [String]?
    var text: String?
    var version: Int?
}

extension WireMessage {
    static func hello(name: String, role: String) -> WireMessage {
        WireMessage(type: "hello", name: name, role: role, names: nil, text: nil, version: 1)
    }

    static func welcome(host: String) -> WireMessage {
        WireMessage(type: "welcome", name: host, role: "host", names: nil,
                    text: "已连上 \(host) 的牌桌", version: 1)
    }

    static func peers(_ names: [String]) -> WireMessage {
        WireMessage(type: "peers", name: nil, role: nil, names: names,
                    text: nil, version: 1)
    }
}
