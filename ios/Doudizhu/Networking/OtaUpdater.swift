import CryptoKit
import Foundation
import WebKit

struct OtaState: Codable {
    var activeVersion: String?
    var activeDirName: String?
    var previousVersion: String?
    var installedAt: String?
    /// 启动失败被回退的版本；同一版本不会再次自动安装。
    var rejectedVersion: String?
}

private struct OtaComplete: Codable {
    let version: String
    let installedAt: String
    let files: Int
}

/// 管理下载目录和“当前生效版本”。OTA 内容只覆盖可热更新的 Web/引擎部分；
/// Pyodide、NumPy 和原生壳始终来自安装包，升级这些仍需重装 IPA。
final class OtaStore {
    let bundleRoot: URL
    let baseDir: URL
    private let fm = FileManager.default

    init(bundleRoot: URL? = nil, baseDir: URL? = nil) {
        if let bundleRoot {
            self.bundleRoot = bundleRoot
        } else if let bundled = Bundle.main.url(forResource: "WebAssets", withExtension: nil) {
            self.bundleRoot = bundled
        } else {
            self.bundleRoot = Bundle.main.bundleURL
        }
        if let baseDir {
            self.baseDir = baseDir
        } else {
            let support = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first ?? FileManager.default.temporaryDirectory
            self.baseDir = support.appendingPathComponent("ManorOTA", isDirectory: true)
        }
        ensureDirectory(self.baseDir)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableBase = self.baseDir
        try? mutableBase.setResourceValues(values)
    }

    var versionsDir: URL { baseDir.appendingPathComponent("versions", isDirectory: true) }
    var stagingDir: URL { baseDir.appendingPathComponent("staging", isDirectory: true) }
    var stateURL: URL { baseDir.appendingPathComponent("state.json") }

    // MARK: - versions

    func bundledVersion() -> String {
        let url = bundleRoot.appendingPathComponent("web-version.json")
        if let data = try? Data(contentsOf: url),
           let meta = try? JSONDecoder().decode(OtaWebVersion.self, from: data),
           !meta.version.isEmpty {
            return meta.version
        }
        return Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    func readState() -> OtaState {
        guard let data = try? Data(contentsOf: stateURL),
              let state = try? JSONDecoder().decode(OtaState.self, from: data) else {
            return OtaState()
        }
        return state
    }

    /// 只有完整、校验过、且比安装包新的覆盖版本才会生效。
    func activeRoot() -> URL? {
        let state = readState()
        guard let version = state.activeVersion,
              let dirName = state.activeDirName,
              !dirName.contains("/"), !dirName.contains("..") else { return nil }
        guard OtaVersion.isNewer(version, than: bundledVersion()) else { return nil }
        let root = versionsDir.appendingPathComponent(dirName, isDirectory: true)
        guard root.standardizedFileURL.path.hasPrefix(versionsDir.standardizedFileURL.path + "/") else {
            return nil
        }
        let marker = root.appendingPathComponent(".complete.json")
        guard let markerData = try? Data(contentsOf: marker),
              let complete = try? JSONDecoder().decode(OtaComplete.self, from: markerData),
              complete.version == version else { return nil }
        // 未变化的文件不复制到覆盖层，由 LocalWebServer 回落到安装包；
        // 版本标记必须存在，证明这次安装完整走完。
        guard fm.fileExists(atPath: root.appendingPathComponent("web-version.json").path) else {
            return nil
        }
        return root
    }

    func effectiveVersion() -> String {
        if let root = activeRoot(),
           let data = try? Data(contentsOf: root.appendingPathComponent("web-version.json")),
           let meta = try? JSONDecoder().decode(OtaWebVersion.self, from: data),
           !meta.version.isEmpty {
            return meta.version
        }
        return bundledVersion()
    }

    func usedActiveVersion() -> String? {
        activeRoot() == nil ? nil : readState().activeVersion
    }

    func isRejected(_ version: String) -> Bool {
        readState().rejectedVersion == version
    }

    /// 启动失败时回退到安装包；把坏版本记为 rejected，避免重启后再次装入。
    func deactivate(rejected: String? = nil) {
        var state = readState()
        let active = state.activeVersion
        state.previousVersion = active ?? state.previousVersion
        if let rejected {
            state.rejectedVersion = rejected
        } else if let active {
            state.rejectedVersion = active
        }
        state.activeVersion = nil
        state.activeDirName = nil
        do {
            let data = try JSONEncoder().encode(state)
            try data.write(to: stateURL, options: .atomic)
        } catch {
            // 回退失败也保持安装包可启动；状态写失败只记录，不阻断重试。
            print("MANOR OTA deactivate failed: \(error.localizedDescription)")
        }
    }

    func makeStaging() throws -> URL {
        ensureDirectory(stagingDir)
        let dir = stagingDir.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func discard(_ url: URL) {
        try? fm.removeItem(at: url)
    }

    func cleanStaleStaging(olderThan seconds: TimeInterval = 24 * 3600) {
        guard let items = try? fm.contentsOfDirectory(
            at: stagingDir,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return }
        let cutoff = Date().addingTimeInterval(-seconds)
        for item in items {
            let date = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            if date < cutoff { try? fm.removeItem(at: item) }
        }
    }

    /// staging 里的文件已经逐个校验过；这里只做原子切换。
    @discardableResult
    func install(staging: URL, manifest: OtaManifest) throws -> String {
        try manifest.validate()
        ensureDirectory(versionsDir)
        let name = "\(manifest.version)-\(UUID().uuidString.prefix(8))"
        let target = versionsDir.appendingPathComponent(name, isDirectory: true)
        let complete = OtaComplete(
            version: manifest.version,
            installedAt: OtaTimestamp.now(),
            files: manifest.files.count
        )
        let marker = staging.appendingPathComponent(".complete.json")
        let markerData = try JSONEncoder().encode(complete)
        do {
            try markerData.write(to: marker, options: .atomic)
            try fm.moveItem(at: staging, to: target)
        } catch {
            discard(staging)
            throw OtaError.io("安装离线包失败：\(error.localizedDescription)")
        }

        let old = readState()
        var state = OtaState(
            activeVersion: manifest.version,
            activeDirName: name,
            previousVersion: old.activeVersion,
            installedAt: complete.installedAt,
            rejectedVersion: old.rejectedVersion
        )
        // 如果旧版本本来就是安装包自带的，不需要再把它记成“上一版”。
        if let previous = state.previousVersion,
           !OtaVersion.isNewer(previous, than: bundledVersion()) {
            state.previousVersion = nil
        }
        do {
            let data = try JSONEncoder().encode(state)
            try data.write(to: stateURL, options: .atomic)
        } catch {
            discard(target)
            throw OtaError.io("保存更新状态失败：\(error.localizedDescription)")
        }
        prune(oldDir: old.activeDirName, keep: name)
        return name
    }

    private func prune(oldDir: String?, keep: String) {
        guard let items = try? fm.contentsOfDirectory(at: versionsDir, includingPropertiesForKeys: nil) else {
            return
        }
        for item in items {
            let name = item.lastPathComponent
            if name == keep || name == oldDir { continue }
            try? fm.removeItem(at: item)
        }
    }

    private func ensureDirectory(_ url: URL) {
        try? fm.createDirectory(at: url, withIntermediateDirectories: true)
    }
}

enum OtaTimestamp {
    static func now() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}

enum OtaVersion {
    /// 自然排序，够用于日期型版本（20261102d）和简单语义版本（0.5.1）。
    static func isNewer(_ lhs: String, than rhs: String) -> Bool {
        let left = chunks(lhs)
        let right = chunks(rhs)
        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : .number(0)
            let b = index < right.count ? right[index] : .number(0)
            switch (a, b) {
            case (.number(let x), .number(let y)):
                if x != y { return x > y }
            case (.text(let x), .text(let y)):
                if x != y { return x > y }
            case (.number, .text):
                return true
            case (.text, .number):
                return false
            }
        }
        return false
    }

    private enum Chunk {
        case number(Int)
        case text(String)
    }

    private static func chunks(_ text: String) -> [Chunk] {
        var result: [Chunk] = []
        var current = ""
        var currentIsNumber: Bool?
        for ch in text {
            let isNumber = ch.isNumber
            if currentIsNumber == nil || currentIsNumber == isNumber {
                current.append(ch)
                currentIsNumber = isNumber
            } else {
                result.append(currentIsNumber == true ? .number(Int(current) ?? 0) : .text(current))
                current = String(ch)
                currentIsNumber = isNumber
            }
        }
        if !current.isEmpty {
            result.append(currentIsNumber == true ? .number(Int(current) ?? 0) : .text(current))
        }
        return result
    }
}

/// 原生侧 OTA：检查清单、逐文件校验、原子切换；任何失败都不影响当前版本。
final class OtaManager: NSObject, WKScriptMessageHandler {
    static let shared = OtaManager()

    private static let lastCheckKey = "manor.otaLastCheck"
    private static let autoCheckInterval: TimeInterval = 10 * 60

    private let store: OtaStore
    private let session: URLSession
    private weak var webView: WKWebView?
    private var checking = false
    private var lastError: String?
    private var lastChecked: Date?

    init(store: OtaStore? = nil, session: URLSession? = nil) {
        self.store = store ?? OtaStore()
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 15 * 60
            config.waitsForConnectivity = false
            config.httpMaximumConnectionsPerHost = 2
            self.session = URLSession(configuration: config)
        }
        if let saved = UserDefaults.standard.object(forKey: Self.lastCheckKey) as? Date {
            lastChecked = saved
        }
        super.init()
    }

    func bind(webView: WKWebView) {
        self.webView = webView
    }

    var serverURL: URL { HomeServer.url }
    var baseURL: URL { HomeServer.otaBaseURL() }

    var shellVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    static func normalizedBaseURL(_ raw: String) -> URL? {
        HomeServer.normalized(raw)
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        switch action {
        case "status":
            emitStatus()
        case "check":
            let manual = (body["manual"] as? Bool) ?? !((body["auto"] as? Bool) ?? false)
            check(manual: manual)
        case "setBase":
            guard let raw = body["base"] as? String,
                  let url = HomeServer.normalized(raw) else {
                emit(["type": "error", "message": "服务器地址格式不对"])
                return
            }
            HomeServer.save(url)
            emit(["type": "sourceSaved", "baseURL": url.absoluteString])
            emitStatus()
        default:
            break
        }
    }

    func check(manual: Bool) {
        if checking {
            emitStatus()
            return
        }
        if !manual, let lastChecked,
           Date().timeIntervalSince(lastChecked) < Self.autoCheckInterval {
            emitStatus()
            return
        }
        checking = true
        lastError = nil
        let base = baseURL
        let current = store.effectiveVersion()
        let shell = shellVersion
        emit(["type": "checking"])
        store.cleanStaleStaging()
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            do {
                let manifest = try await self.fetchManifest(base: base)
                try manifest.validate()
                if OtaSemver.isOlder(shell, than: manifest.minShell) {
                    throw OtaError.needsNewShell(manifest.minShell)
                }
                if self.store.isRejected(manifest.version) {
                    throw OtaError.invalidManifest("该离线包上次启动失败，已跳过，等下一个版本")
                }
                if !OtaVersion.isNewer(manifest.version, than: current) {
                    self.finishSuccess(["type": "latest", "version": current])
                    return
                }
                let installed = try await self.download(manifest: manifest, base: base)
                self.finishSuccess([
                    "type": "ready",
                    "version": manifest.version,
                    "activeDir": installed,
                ])
            } catch {
                self.finishFailure(error)
            }
        }
    }

    // MARK: - network

    private func fetchManifest(base: URL) async throws -> OtaManifest {
        let url = base.appendingPathComponent("manifest.json")
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw OtaError.badResponse }
        guard http.statusCode == 200 else { throw OtaError.http(http.statusCode) }
        guard data.count <= 2 * 1024 * 1024 else {
            throw OtaError.invalidManifest("清单过大")
        }
        do {
            return try JSONDecoder().decode(OtaManifest.self, from: data)
        } catch {
            throw OtaError.invalidManifest("清单解析失败")
        }
    }

    private func download(manifest: OtaManifest, base: URL) async throws -> String {
        let staging = try store.makeStaging()
        var doneBytes = 0
        let totalBytes = manifest.files.reduce(0) { $0 + $1.size }
        do {
            for file in manifest.files {
                let bundled = store.bundleRoot.appendingPathComponent(file.path)
                if FileManager.default.fileExists(atPath: bundled.path),
                   (try? bundled.resourceValues(forKeys: [.fileSizeKey]).fileSize) == file.size,
                   (try? OtaHash.sha256(fileAt: bundled)) == file.sha256 {
                    doneBytes += file.size
                    self.emitProgress(doneBytes: doneBytes, totalBytes: totalBytes, done: file.path, total: manifest.files.count)
                    continue
                }
                let remote = try remoteURL(base: base, relative: file.url)
                var request = URLRequest(url: remote)
                request.cachePolicy = .reloadIgnoringLocalCacheData
                request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                request.timeoutInterval = 120
                let (temp, response) = try await session.download(for: request)
                defer { try? FileManager.default.removeItem(at: temp) }
                guard let http = response as? HTTPURLResponse else { throw OtaError.badResponse }
                guard http.statusCode == 200 else { throw OtaError.http(http.statusCode) }
                let size = (try? temp.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1
                guard size == file.size else { throw OtaError.sizeMismatch(file.path) }
                let digest = try OtaHash.sha256(fileAt: temp)
                guard digest == file.sha256 else {
                    throw OtaError.hashMismatch(file.path)
                }
                let dest = staging.appendingPathComponent(file.path)
                try FileManager.default.createDirectory(
                    at: dest.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try FileManager.default.moveItem(at: temp, to: dest)
                doneBytes += file.size
                self.emitProgress(doneBytes: doneBytes, totalBytes: totalBytes, done: file.path, total: manifest.files.count)
            }
            let name = try store.install(staging: staging, manifest: manifest)
            return name
        } catch {
            store.discard(staging)
            throw error
        }
    }

    private func remoteURL(base: URL, relative: String) throws -> URL {
        guard OtaPath.isSafeRelativeURL(relative) else {
            throw OtaError.invalidManifest("下载地址不安全")
        }
        guard let decoded = relative.removingPercentEncoding else {
            throw OtaError.invalidManifest("下载地址无法解码")
        }
        let url = base.appendingPathComponent(decoded)
        let basePath = base.standardizedFileURL.path.hasSuffix("/")
            ? base.standardizedFileURL.path
            : base.standardizedFileURL.path + "/"
        guard url.standardizedFileURL.path.hasPrefix(basePath) else {
            throw OtaError.invalidManifest("下载地址越界")
        }
        return url
    }

    // MARK: - events

    private func finishSuccess(_ event: [String: Any]) {
        DispatchQueue.main.async {
            self.checking = false
            self.lastError = nil
            self.recordCheck()
            self.emit(event)
            self.emitStatus()
        }
    }

    private func finishFailure(_ error: Error) {
        DispatchQueue.main.async {
            self.checking = false
            self.lastError = error.localizedDescription
            self.recordCheck()
            if case OtaError.needsNewShell(let version) = error {
                self.emit(["type": "needsShell", "minShell": version])
            } else {
                self.emit(["type": "error", "message": error.localizedDescription])
            }
            self.emitStatus()
        }
    }

    private func recordCheck() {
        let now = Date()
        lastChecked = now
        UserDefaults.standard.set(now, forKey: Self.lastCheckKey)
    }

    private func emitProgress(doneBytes: Int, totalBytes: Int, done: String, total: Int) {
        emit([
            "type": "downloading",
            "doneBytes": doneBytes,
            "totalBytes": totalBytes,
            "done": done,
            "total": total,
        ])
    }

    private func emitStatus() {
        var payload: [String: Any] = [
            "type": "status",
            "effectiveVersion": store.effectiveVersion(),
            "bundledVersion": store.bundledVersion(),
            "baseURL": serverURL.absoluteString,
            "shellVersion": shellVersion,
            "checking": checking,
        ]
        if let active = store.usedActiveVersion() { payload["activeVersion"] = active }
        if let lastChecked {
            let formatter = DateFormatter()
            formatter.dateFormat = "MM-dd HH:mm"
            payload["lastChecked"] = formatter.string(from: lastChecked)
        }
        if let lastError { payload["lastError"] = lastError }
        emit(payload)
    }

    private func emit(_ payload: [String: Any]) {
        DispatchQueue.main.async {
            guard let webView = self.webView,
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript(
                "window.manorOtaEvent && window.manorOtaEvent(\(json));",
                completionHandler: nil
            )
        }
    }
}
