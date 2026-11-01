import Foundation
import MultipeerConnectivity
import WebKit

/// 同房间联机：MultipeerConnectivity（蓝牙发现 + 点对点传输）。
/// 原生只搬运 JSON；房主的 Python 牌桌和客人 UI 通过 JS 桥沟通。
final class NearbyManager: NSObject {
    static let shared = NearbyManager()

    private enum Role {
        case idle
        case host
        case guest
    }

    private let serviceType = "manor-ddz"
    private var role: Role = .idle
    private var localPeer: MCPeerID?
    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var foundPeers: [String: MCPeerID] = [:]
    private var guestName = "家人"
    private weak var webView: WKWebView?

    func bind(webView: WKWebView) {
        self.webView = webView
    }

    // ---------------------------------------------------------------- actions

    private func startHost(name: String) {
        let display = cleanName(name, suffix: "的牌桌")
        teardown(notify: false)
        guard let peer = makePeer(display) else { return }
        let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        session.delegate = self
        let advertiser = MCNearbyServiceAdvertiser(
            peer: peer,
            discoveryInfo: ["name": display],
            serviceType: serviceType
        )
        advertiser.delegate = self
        advertiser.startAdvertisingPeer()
        localPeer = peer
        self.session = session
        self.advertiser = advertiser
        role = .host
        emit(["type": "hosting", "name": display])
    }

    private func startGuest(name: String) {
        let display = cleanName(name, suffix: "")
        guestName = display
        teardown(notify: false)
        guard let peer = makePeer(display) else { return }
        let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        session.delegate = self
        let browser = MCNearbyServiceBrowser(peer: peer, serviceType: serviceType)
        browser.delegate = self
        browser.startBrowsingForPeers()
        localPeer = peer
        self.session = session
        self.browser = browser
        role = .guest
        emit(["type": "browsing"])
    }

    private func join(_ host: String) {
        guard role == .guest, let browser, let session, let peer = foundPeers[host] else {
            emit(["type": "error", "message": "这张牌桌已经不在了"])
            return
        }
        browser.invitePeer(peer, to: session, withContext: nil, timeout: 20)
        emit(["type": "connecting", "host": peer.displayName])
    }

    private func send(text: String, to target: String?) {
        guard let session, !text.isEmpty else { return }
        let peers: [MCPeerID]
        if let target, !target.isEmpty {
            peers = session.connectedPeers.filter { $0.displayName == target }
        } else {
            peers = session.connectedPeers
        }
        if peers.isEmpty { return }
        guard let data = text.data(using: .utf8) else { return }
        try? session.send(data, toPeers: peers, with: .reliable)
    }

    private func stop() {
        teardown(notify: true)
    }

    private func teardown(notify: Bool) {
        advertiser?.stopAdvertisingPeer()
        advertiser?.delegate = nil
        advertiser = nil
        browser?.stopBrowsingForPeers()
        browser?.delegate = nil
        browser = nil
        session?.disconnect()
        session?.delegate = nil
        session = nil
        localPeer = nil
        foundPeers.removeAll()
        role = .idle
        if notify {
            emit(["type": "stopped"])
        }
    }

    private func makePeer(_ name: String) -> MCPeerID? {
        let text = String(name.prefix(30))
        guard !text.isEmpty else {
            emit(["type": "error", "message": "先给自己起个名字"])
            return nil
        }
        return MCPeerID(displayName: text)
    }

    private func cleanName(_ raw: String, suffix: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? "家人" : trimmed
        return String((base + suffix).prefix(30))
    }

    private func emit(_ payload: [String: Any]) {
        guard let webView else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            webView.evaluateJavaScript("window.manorNearbyEvent && window.manorNearbyEvent(\(json));")
        }
    }
}

extension NearbyManager: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "manorNearby",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "host":
            startHost(name: body["name"] as? String ?? "家人")
        case "browse":
            startGuest(name: body["name"] as? String ?? "家人")
        case "join":
            join(body["host"] as? String ?? "")
        case "send":
            send(text: body["text"] as? String ?? "", to: body["to"] as? String)
        case "stop":
            stop()
        default:
            break
        }
    }
}

extension NearbyManager: MCNearbyServiceAdvertiserDelegate {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser,
                    didReceiveInvitationFromPeer peerID: MCPeerID,
                    withContext context: Data?,
                    invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        guard role == .host, let session else {
            invitationHandler(false, nil)
            return
        }
        invitationHandler(true, session)
    }

    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        emit(["type": "error", "message": "开不了附近牌桌：\(error.localizedDescription)"])
    }
}

extension NearbyManager: MCNearbyServiceBrowserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser,
                 foundPeer peerID: MCPeerID,
                 withDiscoveryInfo info: [String: String]?) {
        foundPeers[peerID.displayName] = peerID
        emit([
            "type": "hosts",
            "hosts": foundPeers.keys.sorted().map { ["id": $0, "name": $0] },
        ])
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        foundPeers.removeValue(forKey: peerID.displayName)
        emit([
            "type": "hosts",
            "hosts": foundPeers.keys.sorted().map { ["id": $0, "name": $0] },
        ])
    }

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        emit(["type": "error", "message": "找不了附近牌桌：\(error.localizedDescription)"])
    }
}

extension NearbyManager: MCSessionDelegate {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        switch state {
        case .connected:
            if role == .host {
                emit(["type": "peerjoined", "name": peerID.displayName])
            } else if role == .guest {
                emit([
                    "type": "joined",
                    "host": peerID.displayName,
                    "peers": session.connectedPeers.map(\.displayName),
                ])
            }
        case .notConnected:
            if role == .host {
                emit(["type": "peerleft", "name": peerID.displayName])
            } else if role == .guest {
                emit(["type": "disconnected", "name": peerID.displayName])
            }
        default:
            break
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        if role == .host {
            emit(["type": "peerdata", "from": peerID.displayName, "text": text])
        } else if role == .guest {
            emit(["type": "data", "text": text])
        }
    }

    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {
        stream.close()
    }

    func session(_ session: MCSession,
                 didStartReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID,
                 with progress: Progress) {
    }

    func session(_ session: MCSession,
                 didFinishReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID,
                 at localURL: URL?,
                 withError error: Error?) {
    }

    func session(_ session: MCSession,
                 didReceiveCertificate certificate: [Any]?,
                 fromPeer peerID: MCPeerID,
                 certificateHandler: @escaping (Bool) -> Void) {
        certificateHandler(true)
    }
}
