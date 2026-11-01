import CryptoKit
import Foundation

/// 端侧 OTA 清单：只包含可热更新的 Web/引擎/AI 文件，不包含原生壳和 Pyodide 运行时。
struct OtaManifest: Decodable {
    let schema: Int
    let version: String
    let minShell: String
    let files: [OtaFile]

    func validate() throws {
        guard schema == 1 else {
            throw OtaError.invalidManifest("清单格式版本不支持：\(schema)")
        }
        guard Self.validVersion(version) else {
            throw OtaError.invalidManifest("离线包版本号不合法")
        }
        guard OtaSemver.isValid(minShell) else {
            throw OtaError.invalidManifest("最低安装包版本不合法")
        }
        guard !files.isEmpty else {
            throw OtaError.invalidManifest("清单没有文件")
        }
        var seen = Set<String>()
        for file in files {
            guard OtaPath.isSafe(file.path) else {
                throw OtaError.invalidManifest("文件路径不安全：\(file.path)")
            }
            guard seen.insert(file.path).inserted else {
                throw OtaError.invalidManifest("文件重复：\(file.path)")
            }
            guard file.size >= 0, file.sha256.count == 64,
                  file.sha256.allSatisfy({ "0123456789abcdef".contains($0) }) else {
                throw OtaError.invalidManifest("文件校验信息不合法：\(file.path)")
            }
            guard OtaPath.isSafeRelativeURL(file.url) else {
                throw OtaError.invalidManifest("下载地址不安全：\(file.url)")
            }
        }
        for required in ["index.html", "app-core.zip", "web-version.json"] {
            guard seen.contains(required) else {
                throw OtaError.invalidManifest("离线包缺少 \(required)")
            }
        }
    }

    private static func validVersion(_ text: String) -> Bool {
        !text.isEmpty && text.count <= 32 && text.allSatisfy {
            $0.unicodeScalars.allSatisfy { $0.isASCII } && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "_" || $0 == "-")
        }
    }
}

struct OtaFile: Decodable {
    let path: String
    let sha256: String
    let size: Int
    let url: String
}

struct OtaWebVersion: Decodable {
    let version: String
    let minShell: String?

    enum CodingKeys: String, CodingKey {
        case version
        case minShell = "min_shell"
    }
}

enum OtaError: LocalizedError {
    case invalidManifest(String)
    case badResponse
    case http(Int)
    case sizeMismatch(String)
    case hashMismatch(String)
    case io(String)
    case needsNewShell(String)

    var errorDescription: String? {
        switch self {
        case .invalidManifest(let message): return message
        case .badResponse: return "更新服务器返回了无效数据"
        case .http(let code): return "更新服务器返回 HTTP \(code)"
        case .sizeMismatch(let path): return "文件大小不一致：\(path)"
        case .hashMismatch(let path): return "文件校验失败：\(path)"
        case .io(let message): return message
        case .needsNewShell(let version): return "新离线包需要 \(version) 以上的安装包"
        }
    }
}

enum OtaPath {
    static func isSafe(_ path: String) -> Bool {
        guard !path.isEmpty, path.count <= 240, !path.hasPrefix("/"), !path.contains("\\"),
              !path.contains("\0") else { return false }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.isEmpty else { return false }
        for part in parts {
            if part.isEmpty || part == "." || part == ".." { return false }
        }
        return true
    }

    static func isSafeRelativeURL(_ text: String) -> Bool {
        guard !text.isEmpty, !text.contains("://"), !text.hasPrefix("/"),
              let decoded = text.removingPercentEncoding else { return false }
        return isSafe(decoded)
    }
}

enum OtaSemver {
    static func isValid(_ text: String) -> Bool {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (2...3).contains(parts.count) else { return false }
        return parts.allSatisfy { part in
            !part.isEmpty && part.allSatisfy { $0.isNumber }
        }
    }

    /// true 表示 lhs 比 rhs 旧。只用于安装包版本下限，不做完整 semver 语法。
    static func isOlder(_ lhs: String, than rhs: String) -> Bool {
        let a = numbers(lhs)
        let b = numbers(rhs)
        for index in 0..<max(a.count, b.count) {
            let left = index < a.count ? a[index] : 0
            let right = index < b.count ? b[index] : 0
            if left != right { return left < right }
        }
        return false
    }

    private static func numbers(_ text: String) -> [Int] {
        text.split(separator: ".").map { Int($0) ?? 0 }
    }
}

enum OtaHash {
    static func sha256(fileAt url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let data = try handle.read(upToCount: 1024 * 1024)
            guard let data, !data.isEmpty else { break }
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
