import Foundation
import Network

/// 加入端：连到 Bonjour 发现的牌桌，同步桌边名单。
final class TableClient {
    struct Status {
        var connected = false
        var hostName = ""
        var peers: [String] = []
        var error: String?
    }

    var onUpdate: ((Status) -> Void)?

    private let myName: String
    private var peer: LinePeer?
    private var status = Status()
    private var timeout: DispatchWorkItem?

    init(myName: String) {
        self.myName = myName
    }

    func connect(to endpoint: NWEndpoint) {
        disconnect()
        let parameters = NWParameters.tcp
        let connection = NWConnection(to: endpoint, using: parameters)
        let peer = LinePeer(connection: connection)

        peer.onReady = { [weak self, weak peer] in
            guard let self, let peer else { return }
            self.timeout?.cancel()
            self.timeout = nil
            self.status.connected = true
            self.status.error = nil
            peer.send(.hello(name: self.myName, role: "client"))
            self.publish()
        }
        peer.onMessage = { [weak self] message in
            self?.handle(message)
        }
        peer.onClose = { [weak self] in
            self?.handleClose()
        }

        self.peer = peer
        peer.start()

        let timeout = DispatchWorkItem { [weak self] in
            guard let self, !self.status.connected else { return }
            self.status.error = "连接超时：确认两台设备在同一个 Wi-Fi，对方还开着牌桌"
            self.peer?.cancel()
            self.peer = nil
            self.publish()
        }
        self.timeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)
    }

    func disconnect() {
        timeout?.cancel()
        timeout = nil
        peer?.cancel()
        peer = nil
        status = Status()
        publish()
    }

    private func handle(_ message: WireMessage) {
        switch message.type {
        case "welcome":
            if let name = message.name, !name.isEmpty {
                status.hostName = name
            }
            status.connected = true
            status.error = nil
        case "peers":
            status.peers = message.names ?? []
            if status.hostName.isEmpty, let first = status.peers.first {
                status.hostName = first
            }
        default:
            break
        }
        publish()
    }

    private func handleClose() {
        timeout?.cancel()
        timeout = nil
        guard peer != nil else { return }
        peer = nil
        status.connected = false
        if status.error == nil {
            status.error = "连接已断开，房主可能关掉了牌桌"
        }
        publish()
    }

    private func publish() {
        let snapshot = status
        if Thread.isMainThread {
            onUpdate?(snapshot)
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.onUpdate?(snapshot)
            }
        }
    }
}
