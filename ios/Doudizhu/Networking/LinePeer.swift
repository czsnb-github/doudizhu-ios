import Foundation
import Network

/// 一条 TCP 连接上的按行 JSON 收发。
/// 只负责传输，不懂牌局；主线程回调，方便直接驱动 SwiftUI。
final class LinePeer {
    var onReady: (() -> Void)?
    var onMessage: ((WireMessage) -> Void)?
    var onClose: (() -> Void)?

    private let connection: NWConnection
    private let queue: DispatchQueue
    private var buffer = Data()
    private var started = false
    private var closed = false

    init(connection: NWConnection, queue: DispatchQueue = .main) {
        self.connection = connection
        self.queue = queue
    }

    func start() {
        guard !started else { return }
        started = true
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.onReady?()
                self.receive()
            case .failed, .cancelled:
                self.finish()
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    func send(_ message: WireMessage) {
        guard !closed else { return }
        guard let data = try? JSONEncoder().encode(message) else { return }
        var payload = data
        payload.append(0x0A)
        connection.send(content: payload, completion: .contentProcessed { _ in })
    }

    func cancel() {
        guard !closed else { return }
        closed = true
        connection.stateUpdateHandler = nil
        connection.cancel()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                self.buffer.append(data)
                self.parse()
            }
            if error != nil || isComplete {
                self.finish()
                return
            }
            self.receive()
        }
    }

    private func parse() {
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = Data(buffer[buffer.startIndex..<newline])
            buffer.removeSubrange(buffer.startIndex...newline)
            guard !line.isEmpty else { continue }
            if let message = try? JSONDecoder().decode(WireMessage.self, from: line) {
                onMessage?(message)
            }
        }
    }

    private func finish() {
        guard !closed else { return }
        closed = true
        connection.cancel()
        onClose?()
    }
}
