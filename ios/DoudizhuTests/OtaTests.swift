import XCTest
@testable import Doudizhu

final class OtaTests: XCTestCase {
    private var temp: URL!

    override func setUpWithError() throws {
        temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("manor-ota-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let temp { try? FileManager.default.removeItem(at: temp) }
    }

    private func write(_ text: String, to relative: String, under root: URL) throws {
        let url = root.appendingPathComponent(relative)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try text.data(using: .utf8)!.write(to: url)
    }

    private func bundle(version: String) throws -> URL {
        let root = temp.appendingPathComponent("bundle-\(UUID().uuidString)", isDirectory: true)
        try write("<!doctype html>old", to: "index.html", under: root)
        try write("engine", to: "app-core.zip", under: root)
        try write("runtime", to: "pyodide/pyodide.js", under: root)
        try write("boot", to: "static/boot.js", under: root)
        try write("{\"version\":\"\(version)\",\"min_shell\":\"0.5.0\"}", to: "web-version.json", under: root)
        return root
    }

    private func makeManifest(version: String, files: [String]) -> OtaManifest {
        let rows = files.map { path in
            OtaFile(
                path: path,
                sha256: String(repeating: "a", count: 64),
                size: 10,
                url: "files/\(String(repeating: "a", count: 64))/\(path)"
            )
        }
        return OtaManifest(schema: 1, version: version, minShell: "0.5.0", files: rows)
    }

    func testManifestValidationAndSemver() throws {
        let good = makeManifest(version: "20261102d", files: ["index.html", "app-core.zip", "web-version.json"])
        XCTAssertNoThrow(try good.validate())
        XCTAssertTrue(OtaSemver.isValid("0.5.0"))
        XCTAssertTrue(OtaSemver.isOlder("0.4.9", than: "0.5.0"))
        XCTAssertFalse(OtaSemver.isOlder("0.5.0", than: "0.5.0"))
        XCTAssertTrue(OtaVersion.isNewer("20261102d", than: "20261102c"))
        XCTAssertTrue(OtaVersion.isNewer("0.10.0", than: "0.9.9"))
        XCTAssertFalse(OtaVersion.isNewer("20261102c", than: "20261102d"))

        let traversal = OtaManifest(
            schema: 1,
            version: "20261102d",
            minShell: "0.5.0",
            files: [
                OtaFile(path: "../escape", sha256: String(repeating: "a", count: 64), size: 1, url: "files/a"),
                OtaFile(path: "index.html", sha256: String(repeating: "a", count: 64), size: 1, url: "files/a"),
                OtaFile(path: "app-core.zip", sha256: String(repeating: "a", count: 64), size: 1, url: "files/a"),
                OtaFile(path: "web-version.json", sha256: String(repeating: "a", count: 64), size: 1, url: "files/a"),
            ]
        )
        XCTAssertThrowsError(try traversal.validate())

        let missing = makeManifest(version: "20261102d", files: ["index.html"])
        XCTAssertThrowsError(try missing.validate())
    }

    func testStoreInstallsVersionAndFallsBackToNewerBundle() throws {
        let bundleRoot = try bundle(version: "20261102c")
        let base = temp.appendingPathComponent("ota", isDirectory: true)
        let store = OtaStore(bundleRoot: bundleRoot, baseDir: base)
        XCTAssertEqual(store.effectiveVersion(), "20261102c")
        XCTAssertNil(store.activeRoot())

        let staging = try store.makeStaging()
        try write("<!doctype html>new", to: "index.html", under: staging)
        try write("engine-new", to: "app-core.zip", under: staging)
        try write("{\"version\":\"20261102d\"}", to: "web-version.json", under: staging)
        let manifest = makeManifest(
            version: "20261102d",
            files: ["index.html", "app-core.zip", "web-version.json"]
        )
        try store.install(staging: staging, manifest: manifest)

        XCTAssertEqual(store.effectiveVersion(), "20261102d")
        XCTAssertEqual(store.usedActiveVersion() ?? "", "20261102d")
        let active = try XCTUnwrap(store.activeRoot())
        XCTAssertTrue(FileManager.default.fileExists(atPath: active.appendingPathComponent("index.html").path))

        // 重装一个更新的安装包后，应该优先使用安装包，而不是旧 OTA。
        let newerBundle = try bundle(version: "20261105a")
        let sameBase = OtaStore(bundleRoot: newerBundle, baseDir: base)
        XCTAssertNil(sameBase.activeRoot())
        XCTAssertEqual(sameBase.effectiveVersion(), "20261105a")
    }

    func testLocalServerResolvesOverlayThenBundleAndRejectsTraversal() throws {
        let bundleRoot = try bundle(version: "20261102c")
        let overlay = temp.appendingPathComponent("overlay", isDirectory: true)
        try write("<!doctype html>overlay", to: "index.html", under: overlay)
        try write("new-ui", to: "static/app.js", under: overlay)
        let server = LocalWebServer(bundleRoot: bundleRoot, overlayRoot: overlay)

        XCTAssertEqual(
            server.resolve(relative: "index.html")?.deletingLastPathComponent().path ?? "",
            overlay.standardizedFileURL.path
        )
        XCTAssertEqual(
            server.resolve(relative: "static/app.js")?.deletingLastPathComponent().path ?? "",
            overlay.appendingPathComponent("static").standardizedFileURL.path
        )
        XCTAssertEqual(
            server.resolve(relative: "app-core.zip")?.deletingLastPathComponent().path ?? "",
            bundleRoot.standardizedFileURL.path
        )
        XCTAssertEqual(
            server.resolve(relative: "pyodide/pyodide.js")?.deletingLastPathComponent().path ?? "",
            bundleRoot.appendingPathComponent("pyodide").standardizedFileURL.path
        )
        XCTAssertNil(server.resolve(relative: "../outside.txt"))
        XCTAssertNil(server.resolve(relative: "missing.txt"))
    }

    func testHashAndBaseURLNormalization() throws {
        let file = temp.appendingPathComponent("hello.txt")
        try "hello".data(using: .utf8)!.write(to: file)
        XCTAssertEqual(
            try OtaHash.sha256(fileAt: file),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        )
        XCTAssertEqual(
            OtaManager.normalizedBaseURL("192.168.31.182:8000")?.absoluteString ?? "",
            "http://192.168.31.182:8000/"
        )
        XCTAssertNil(OtaManager.normalizedBaseURL("ftp://example.com/xxx"))
        XCTAssertNil(OtaManager.normalizedBaseURL("   "))
    }
}
