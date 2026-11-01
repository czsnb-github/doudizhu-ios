import XCTest
import Network
@testable import Doudizhu

@MainActor
final class TableHostClientTests: XCTestCase {
    func testHostAndClientExchangeNames() throws {
        let host = TableHost(hostName: "房主", advertise: false)
        let hostReady = expectation(description: "host ready")
        var port: UInt16 = 0
        var hostNames: [String] = []
        var hostReadyFired = false

        host.onUpdate = { status in
            hostNames = status.names
            if status.port != 0 && !hostReadyFired {
                hostReadyFired = true
                port = status.port
                hostReady.fulfill()
            }
        }
        host.start()
        wait(for: [hostReady], timeout: 5)
        XCTAssertNotEqual(port, 0)

        let client = TableClient(myName: "客人")
        let joined = expectation(description: "client joined")
        var clientNames: [String] = []
        var joinedFired = false

        client.onUpdate = { status in
            clientNames = status.peers
            if status.connected,
               status.peers.contains("房主"),
               status.peers.contains("客人"),
               !joinedFired {
                joinedFired = true
                joined.fulfill()
            }
        }

        let endpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: port)!
        )
        client.connect(to: endpoint)
        wait(for: [joined], timeout: 10)

        XCTAssertEqual(Set(hostNames), Set(["房主", "客人"]))
        XCTAssertEqual(Set(clientNames), Set(["房主", "客人"]))

        client.disconnect()
        host.stop()
    }
}
