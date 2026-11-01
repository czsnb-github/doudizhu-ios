import XCTest
import MultipeerConnectivity

final class NearbyTransportTests: XCTestCase {
    private var hostSession: MCSession!
    private var guestSession: MCSession!
    private var advertiser: MCNearbyServiceAdvertiser!
    private var browser: MCNearbyServiceBrowser!
    private var done: XCTestExpectation!
    private var failure: String?
    private var sent = false

    private let serviceType = "manor-ddz"

    override func tearDown() {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        hostSession?.disconnect()
        guestSession?.disconnect()
        advertiser = nil
        browser = nil
        hostSession = nil
        guestSession = nil
        super.tearDown()
    }

    func testAdvertiseBrowseConnectAndSend() {
        done = expectation(description: "MCS 往返")
        let suffix = UUID().uuidString.prefix(6)
        let hostID = MCPeerID(displayName: "host-\(suffix)")
        let guestID = MCPeerID(displayName: "guest-\(suffix)")

        hostSession = MCSession(peer: hostID, securityIdentity: nil, encryptionPreference: .required)
        hostSession.delegate = self
        guestSession = MCSession(peer: guestID, securityIdentity: nil, encryptionPreference: .required)
        guestSession.delegate = self

        advertiser = MCNearbyServiceAdvertiser(peer: hostID, discoveryInfo: nil, serviceType: serviceType)
        advertiser.delegate = self
        browser = MCNearbyServiceBrowser(peer: guestID, serviceType: serviceType)
        browser.delegate = self

        advertiser.startAdvertisingPeer()
        browser.startBrowsingForPeers()
        wait(for: [done], timeout: 30)
        XCTAssertNil(failure, failure ?? "")
    }
}

extension NearbyTransportTests: MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser,
                    didReceiveInvitationFromPeer peerID: MCPeerID,
                    withContext context: Data?,
                    invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        invitationHandler(true, hostSession)
    }

    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        failure = "advertiser: \(error.localizedDescription)"
        done.fulfill()
    }

    func browser(_ browser: MCNearbyServiceBrowser,
                 foundPeer peerID: MCPeerID,
                 withDiscoveryInfo info: [String: String]?) {
        browser.invitePeer(peerID, to: guestSession, withContext: nil, timeout: 20)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        failure = "browser: \(error.localizedDescription)"
        done.fulfill()
    }

    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        guard state == .connected, session === guestSession, !sent else { return }
        sent = true
        let payload = Data("ping".utf8)
        try? session.send(payload, toPeers: session.connectedPeers, with: .reliable)
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard session === hostSession else { return }
        if String(data: data, encoding: .utf8) == "ping" {
            done.fulfill()
        }
    }

    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {
        stream.close()
    }

    func session(_ session: MCSession,
                 didStartReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID,
                 with progress: Progress) {}

    func session(_ session: MCSession,
                 didFinishReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID,
                 at localURL: URL?,
                 withError error: Error?) {}

    func session(_ session: MCSession,
                 didReceiveCertificate certificate: [Any]?,
                 fromPeer peerID: MCPeerID,
                 certificateHandler: @escaping (Bool) -> Void) {
        certificateHandler(true)
    }
}
