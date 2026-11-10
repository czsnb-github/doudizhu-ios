import SwiftUI
import UIKit

/// 端侧入口：不连电脑服，启动本机静态服务，WKWebView 直接打开同一套前端。
struct LocalShellView: View {
    @StateObject private var model = LocalShellModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            ManorTheme.cream
                .ignoresSafeArea()

            if let url = model.url {
                WebTableView(
                    url: url,
                    onLoading: {},
                    onReady: {},
                    onFailure: { model.fail($0) },
                    onSettings: {}
                )
            } else {
                splash
            }

            if let error = model.errorText {
                faultOverlay(title: "本机牌桌没起来", message: error)
            } else if let rescue = model.rescueText {
                faultOverlay(title: "本机引擎启动失败", message: rescue)
            }
        }
        .preferredColorScheme(.light)
        .onAppear { model.start() }
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
        }
    }

    private var splash: some View {
        ZStack {
            ManorBackground()
            VStack(spacing: 16) {
                ProgressView()
                    .controlSize(.large)
                    .tint(ManorTheme.green)
                Text("正在唤醒本机牌桌…")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(ManorTheme.inkSoft)
                Text("牌局、档案和 AI 都在这台设备上")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .foregroundStyle(ManorTheme.inkFaint)
            }
        }
        .ignoresSafeArea()
    }

    private func faultOverlay(title: String, message: String) -> some View {
        ZStack {
            ManorTheme.cream.opacity(0.98).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 14) {
                    Text(title)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(ManorTheme.ink)
                    Text(message)
                        .font(.system(size: 13.5, weight: .medium, design: .rounded))
                        .foregroundStyle(ManorTheme.inkSoft)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)

                    Button("重试") { model.retry() }
                        .buttonStyle(ManorPrimaryButtonStyle(fill: ManorTheme.green))
                        .frame(maxWidth: 240)

                    Button("上传诊断日志") { model.uploadLogs() }
                        .buttonStyle(ManorSecondaryButtonStyle())
                        .frame(maxWidth: 240)

                    if model.overlayActive {
                        Button("改用安装包版本") { model.useBundled() }
                            .buttonStyle(ManorSecondaryButtonStyle())
                            .frame(maxWidth: 240)
                    }

                    if let status = model.logStatus {
                        Text(status)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(ManorTheme.inkFaint)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 28)
                    }
                }
                .padding(.vertical, 36)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }
}

@MainActor
final class LocalShellModel: ObservableObject {
    @Published var url: URL?
    @Published var errorText: String?
    @Published var rescueText: String?
    @Published var logStatus: String?
    @Published var overlayActive = false

    private var server: LocalWebServer?
    private var otaStore: OtaStore?
    private var activeVersion: String?
    private var started = false
    private var bundleFallbackTried = false
    private var ready = false
    private var watchdog: DispatchWorkItem?
    private var observers: [NSObjectProtocol] = []

    init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: ClientLogger.bootReady,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.bootReady() }
        })
        observers.append(center.addObserver(
            forName: ClientLogger.bootFailure,
            object: nil,
            queue: .main
        ) { [weak self] note in
            let message = (note.userInfo?[ClientLogger.failureMessageKey] as? String)
                ?? "未知启动错误"
            Task { @MainActor in self?.bootFailed(message) }
        })
    }

    func start() {
        guard !started else { return }
        // 单测宿主也会启动 App；不要在测试进程里加载 50MB 的 Pyodide。
        let env = ProcessInfo.processInfo.environment
        if env["MANOR_DISABLE_LOCAL_UI"] == "1" {
            return
        }
        let isTesting = env["XCTestConfigurationFilePath"] != nil
            || env["XCTestBundlePath"] != nil
            || NSClassFromString("XCTestCase") != nil
        if isTesting {
            return
        }
        started = true
        errorText = nil
        rescueText = nil
        logStatus = nil
        ClientLogger.shared.beginSession()
        let ota = OtaStore()
        otaStore = ota
        activeVersion = ota.usedActiveVersion()
        overlayActive = ota.activeRoot() != nil
        launchServer(overlayRoot: ota.activeRoot())
    }

    private func launchServer(overlayRoot: URL?) {
        watchdog?.cancel()
        watchdog = nil
        ready = false
        // 以"本次实际服务的根"为准，而非 OTA store 状态：超时回退到安装包后
        // store 里仍有健康离线包，若按 store 显示 overlayActive，后续故障会误把
        // 健康版本记为 rejected。
        overlayActive = (overlayRoot != nil)
        activeVersion = overlayRoot != nil ? OtaStore().usedActiveVersion() : nil
        server?.stop()
        url = nil
        errorText = nil
        setIdleTimer(false)
        let server = LocalWebServer(overlayRoot: overlayRoot)
        self.server = server
        ClientLogger.shared.record("server.start", detail: [
            "overlay": overlayRoot?.lastPathComponent ?? "bundle",
        ])
        server.start(onReady: { [weak self] in
            guard let self else { return }
            guard let url = URL(string: "http://127.0.0.1:\(LocalWebServer.port)/") else {
                self.fail("本机地址无效")
                return
            }
            self.url = url
            self.setIdleTimer(true)
            self.scheduleWatchdog()
        }, onError: { [weak self] message in
            self?.fail(message)
        })
    }

    func retry() {
        watchdog?.cancel()
        watchdog = nil
        started = false
        server?.stop()
        server = nil
        url = nil
        errorText = nil
        rescueText = nil
        logStatus = nil
        start()
    }

    func useBundled() {
        ClientLogger.shared.record("rescue.useBundle", detail: [
            "rejected": activeVersion ?? "",
        ])
        otaStore?.deactivate(rejected: activeVersion)
        otaStore = OtaStore()
        activeVersion = nil
        overlayActive = false
        rescueText = nil
        errorText = nil
        bundleFallbackTried = true
        launchServer(overlayRoot: nil)
    }

    func fail(_ message: String) {
        watchdog?.cancel()
        watchdog = nil
        errorText = "本机静态服务启动失败：\(message)"
        url = nil
        setIdleTimer(false)
        ClientLogger.shared.record("server.failure", level: "error", detail: ["message": message])
        ClientLogger.shared.flush()
    }

    func uploadLogs() {
        logStatus = "已提交；连不上服务器时会保留到下次启动重试"
        ClientLogger.shared.flush()
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        if phase == .active {
            setIdleTimer(url != nil)
            // 回到前台才继续计时：后台期间 Pyodide 被挂起，不应计入启动超时。
            if !ready && url != nil && watchdog == nil {
                scheduleWatchdog()
            }
        } else {
            setIdleTimer(false)
            // 暂停看门狗，避免恢复前台时补 fires 把健康离线包误判超时。
            watchdog?.cancel()
            watchdog = nil
        }
    }

    // MARK: - boot health

    private func scheduleWatchdog() {
        watchdog?.cancel()
        let work = DispatchWorkItem { [weak self] in
            Task { @MainActor in self?.bootTimedOut() }
        }
        watchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 90, execute: work)
        ClientLogger.shared.stage("native.watchdog")
    }

    private func bootReady() {
        watchdog?.cancel()
        watchdog = nil
        ready = true
        rescueText = nil
        errorText = nil
        setIdleTimer(url != nil)
    }

    private func bootFailed(_ message: String) {
        watchdog?.cancel()
        watchdog = nil
        ClientLogger.shared.record("rescue.bootFailed", level: "error", detail: [
            "message": message,
            "active": activeVersion ?? "",
            "overlay": overlayActive ? "1" : "0",
        ])
        if overlayActive && !bundleFallbackTried {
            bundleFallbackTried = true
            ClientLogger.shared.record("rescue.rollback", detail: ["rejected": activeVersion ?? ""])
            otaStore?.deactivate(rejected: activeVersion)
            otaStore = OtaStore()
            activeVersion = nil
            overlayActive = false
            rescueText = "离线包启动失败，已切回安装包版本重试…"
            launchServer(overlayRoot: nil)
            return
        }
        rescueText = "\(message)\n\n诊断日志已自动记录；连上家中服务器后会自动上传。"
        setIdleTimer(false)
    }

    private func bootTimedOut() {
        ClientLogger.shared.record("rescue.timeout", level: "error", detail: [
            "active": activeVersion ?? "",
            "overlay": overlayActive ? "1" : "0",
        ])
        ClientLogger.shared.flush()
        if overlayActive && !bundleFallbackTried {
            bundleFallbackTried = true
            // 超时只本次切回安装包，不把版本记为 rejected：超时可能只是设备慢/被挂起，
            // 永久拉黑会让健康离线包再也装不回来。真正的启动错误走 bootFailed 才拉黑。
            ClientLogger.shared.record("rescue.rollback", detail: [
                "version": activeVersion ?? "", "reason": "timeout-session-only",
            ])
            rescueText = "离线包启动超时，本次先切回安装包版本；下次启动会再试离线包。"
            launchServer(overlayRoot: nil)
            return
        }
        rescueText = "启动超过 90 秒还没有就绪。诊断日志已记录，连上家中服务器后会自动上传。"
        setIdleTimer(false)
    }

    private func setIdleTimer(_ on: Bool) {
        UIApplication.shared.isIdleTimerDisabled = on
    }
}
