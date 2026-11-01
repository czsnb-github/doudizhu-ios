import XCTest
@testable import Doudizhu

final class WireMessageTests: XCTestCase {
    func testHelloRoundTrip() throws {
        let message = WireMessage.hello(name: "猫猫", role: "client")
        let data = try JSONEncoder().encode(message)
        let decoded = try JSONDecoder().decode(WireMessage.self, from: data)

        XCTAssertEqual(decoded.type, "hello")
        XCTAssertEqual(decoded.name, "猫猫")
        XCTAssertEqual(decoded.role, "client")
        XCTAssertEqual(decoded.version, 1)
    }

    func testPeersRoundTrip() throws {
        let message = WireMessage.peers(["猫猫", "喵喵"])
        let data = try JSONEncoder().encode(message)
        let decoded = try JSONDecoder().decode(WireMessage.self, from: data)

        XCTAssertEqual(decoded.type, "peers")
        XCTAssertEqual(decoded.names, ["猫猫", "喵喵"])
    }

    func testWelcomeKeepsHostName() throws {
        let message = WireMessage.welcome(host: "房主")
        let data = try JSONEncoder().encode(message)
        let decoded = try JSONDecoder().decode(WireMessage.self, from: data)

        XCTAssertEqual(decoded.type, "welcome")
        XCTAssertEqual(decoded.name, "房主")
        XCTAssertTrue(decoded.text?.contains("房主") == true)
    }
}
