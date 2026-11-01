import Foundation
import Network

/// 只给 WKWebView 用的本机静态文件服务，端口固定，保证 IndexedDB 的 origin 稳定。
final class LocalWebServer {
    static let port: UInt16 = 8765

    private let queue = DispatchQueue(label: "manor.local.web")
    private var listener: NWListener?
    private let root: URL

    init() {
        if let dir = Bundle.main.url(forResource: "WebAssets", withExtension: nil) {
            root = dir
        } else {
            root = Bundle.main.bundleURL
        }
    }

    func start(onReady: @escaping () -> Void, onError: @escaping (String) -> Void) {
        stop()
        guard let nwPort = NWEndpoint.Port(rawValue: Self.port) else {
            onError("本机端口无效")
            return
        }
        do {
            let parameters = NWParameters.tcp
            parameters.allowLocalEndpointReuse = true
            let listener = try NWListener(using: parameters, on: nwPort)
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    print("MANOR local server ready root=\(self?.root.path ?? "")")
                    DispatchQueue.main.async { onReady() }
                case .failed(let error):
                    DispatchQueue.main.async { onError(error.localizedDescription) }
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.accept(connection)
            }
            self.listener = listener
            listener.start(queue: queue)
        } catch {
            onError(error.localizedDescription)
        }
    }

    func stop() {
        listener?.stateUpdateHandler = nil
        listener?.newConnectionHandler = nil
        listener?.cancel()
        listener = nil
    }

    private func accept(_ connection: NWConnection) {
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.readRequest(connection)
            case .failed, .cancelled:
                connection.cancel()
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    private func readRequest(_ connection: NWConnection, buffer: Data = Data()) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) { [weak self] data, _, complete, error in
            guard let self else { return }
            if let data, !data.isEmpty {
                var merged = buffer
                merged.append(data)
                if let headerEnd = merged.range(of: Data("\r\n\r\n".utf8)) {
                    let headerData = merged[..<headerEnd.lowerBound]
                    self.respond(connection, header: String(decoding: headerData, as: UTF8.self))
                    return
                }
                if merged.count > 128 * 1024 {
                    self.sendStatus(connection, code: 431, text: "Request Header Fields Too Large")
                    return
                }
                if complete {
                    self.sendStatus(connection, code: 400, text: "Bad Request")
                    return
                }
                self.readRequest(connection, buffer: merged)
            } else if error != nil || complete {
                connection.cancel()
            } else {
                self.readRequest(connection, buffer: buffer)
            }
        }
    }

    private func respond(_ connection: NWConnection, header: String) {
        let lines = header.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            sendStatus(connection, code: 400, text: "Bad Request")
            return
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            sendStatus(connection, code: 400, text: "Bad Request")
            return
        }
        let method = String(parts[0]).uppercased()
        guard method == "GET" || method == "HEAD" else {
            sendStatus(connection, code: 405, text: "Method Not Allowed")
            return
        }
        var rawPath = String(parts[1])
        if let q = rawPath.firstIndex(of: "?") {
            rawPath = String(rawPath[..<q])
        }
        let decoded = rawPath.removingPercentEncoding ?? rawPath
        var relative = decoded.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if relative.isEmpty {
            relative = "index.html"
        }
        let candidate = root.appendingPathComponent(relative).standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        guard candidate.path == rootPath || candidate.path.hasPrefix(rootPath + "/") else {
            sendStatus(connection, code: 403, text: "Forbidden")
            return
        }
        var fileURL = candidate
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDirectory) else {
            sendStatus(connection, code: 404, text: "Not Found")
            return
        }
        if isDirectory.boolValue {
            fileURL = fileURL.appendingPathComponent("index.html")
        }
        guard let body = try? Data(contentsOf: fileURL) else {
            sendStatus(connection, code: 404, text: "Not Found")
            return
        }
        let mime = Self.mimeType(for: fileURL.pathExtension)
        var head = "HTTP/1.1 200 OK\r\n"
        head += "Content-Type: \(mime)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Cache-Control: no-store\r\n"
        head += "Connection: close\r\n\r\n"
        let headData = Data(head.utf8)
        connection.send(content: headData, completion: .contentProcessed { _ in
            if method == "HEAD" || body.isEmpty {
                connection.cancel()
                return
            }
            connection.send(content: body, completion: .contentProcessed { _ in
                connection.cancel()
            })
        })
    }

    private func sendStatus(_ connection: NWConnection, code: Int, text: String) {
        let body = Data((text + "\n").utf8)
        let head = "HTTP/1.1 \(code) \(text)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(head.utf8), completion: .contentProcessed { _ in
            connection.send(content: body, completion: .contentProcessed { _ in
                connection.cancel()
            })
        })
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico": return "image/x-icon"
        case "wasm": return "application/wasm"
        case "whl": return "application/octet-stream"
        case "zip": return "application/zip"
        case "npz": return "application/octet-stream"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
