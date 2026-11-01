import Foundation
import Network

/// 房主端：开一个 Bonjour 可发现的 TCP 端口，维护所有连接。
/// 这一版只同步“谁在桌边”，牌局状态机随后接进来。
final class TableHost {
    struct Status {
        var running = false
        var port: UInt16 = 0
        var names: [String] = []
        var error: String?
    }

    var onUpdate: ((Status) -> Void)?

    private let hostName: String
    private let advertise: Bool
    private var listener: NWListener?
    private var peers: [UUID: LinePeer] = [:]
    private var peerNames: [UUID: String] = [:]
    private var status = Status()

    init(hostName: String, advertise: Bool = true) {
        self.hostName = hostName
        self.advertise = advertise
    }

    func start() {
        stop()
        do {
            let parameters = NWParameters.tcp
                let listener = try NWListener(using: parameters)
            if advertise {
                listener.service = NWListener.Service(
                    name: "\(hostName)的牌桌",
                    type: "_doudizhu._tcp"
                )
            }
            listener.stateUpdateHandler = { [weak self] state in
                DispatchQueue.main.async {
                    self?.handleListenerState(state)
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                DispatchQueue.main.async {
                    self?.accept(connection)
                }
            }
            self.listener = listener
            status = Status(running: true, port: 0, names: [hostName], error: nil)
            publish()
            listener.start(queue: .main)
        } catch {
            status = Status(running: false, port: 0, names: [], error: "开桌失败：\(error.localizedDescription)")
            publish()
        }
    }

    func stop() {
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.cancel()
        listener = nil
        for peer in peers.values {
            peer.cancel()
        }
        peers.removeAll()
        peerNames.removeAll()
        status = Status()
        publish()
    }

    private func handleListenerState(_ state: NWListener.State) {
        switch state {
        case .ready:
            status.running = true
            status.port = listener?.port?.rawValue ?? 0
            status.error = nil
            publish()
        case .failed(let error):
            status.running = false
            status.error = "牌桌没能开起来：\(error.localizedDescription)"
            publish()
        case .cancelled:
            status.running = false
            publish()
        default:
            break
        }
    }

    private func accept(_ connection: NWConnection) {
        let id = UUID()
        let peer = LinePeer(connection: connection)
        peer.onReady = { [weak self, weak peer] in
            guard let self, let peer else { return }
            peer.send(.welcome(host: self.hostName))
        }
        peer.onMessage = { [weak self] message in
            self?.handle(message, from: id)
        }
        peer.onClose = { [weak self] in
            self?.remove(id)
        }
        peers[id] = peer
        peer.start()
    }

    private func handle(_ message: WireMessage, from id: UUID) {
        switch message.type {
        case "hello":
            let name = (message.name?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap {
                $0.isEmpty ? nil : $0
            } ?? "朋友"
            peerNames[id] = name
            publishNames()
        default:
            break
        }
    }

    private func publishNames() {
        status.names = [hostName] + peerNames.values.sorted()
        status.running = listener != nil
        publish()
        broadcastPeers()
    }

    private func broadcastPeers() {
        let message = WireMessage.peers(status.names)
        for peer in peers.values {
            peer.send(message)
        }
    }

    private func remove(_ id: UUID) {
        guard peers[id] != nil else { return }
        peers[id]?.cancel()
        peers[id] = nil
        peerNames[id] = nil
        publishNames()
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
