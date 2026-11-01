import SwiftUI
import UIKit

/// 端侧入口：不连电脑服，启动本机静态服务，WKWebView 直接打开同一套前端。
struct LocalShellView: View {
    @StateObject private var model = LocalShellModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            if let url = model.url {
                WebTableView(
                    url: url,
                    onLoading: {},
                    onReady: {},
                    onFailure: { model.fail($0) },
                    onSettings: {}
                )
                .ignoresSafeArea()
            } else {
                splash
            }

            if let error = model.errorText {
                errorOverlay(error)
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

    private func errorOverlay(_ message: String) -> some View {
        ZStack {
            ManorTheme.cream.opacity(0.98).ignoresSafeArea()
            VStack(spacing: 14) {
                Text("本机牌桌没起来")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(ManorTheme.ink)
                Text(message)
                    .font(.system(size: 13.5, weight: .medium, design: .rounded))
                    .foregroundStyle(ManorTheme.inkSoft)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                Button("重试") { model.retry() }
                    .buttonStyle(ManorPrimaryButtonStyle(fill: ManorTheme.green))
                    .frame(maxWidth: 220)
                    .padding(.top, 4)
            }
        }
    }
}

@MainActor
final class LocalShellModel: ObservableObject {
    @Published var url: URL?
    @Published var errorText: String?

    private var server: LocalWebServer?
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        errorText = nil
        let server = LocalWebServer()
        self.server = server
        server.start(onReady: { [weak self] in
            guard let self else { return }
            guard let url = URL(string: "http://127.0.0.1:\(LocalWebServer.port)/") else {
                self.fail("本机地址无效")
                return
            }
            self.url = url
            self.setIdleTimer(true)
        }, onError: { [weak self] message in
            self?.fail(message)
        })
    }

    func retry() {
        started = false
        server?.stop()
        server = nil
        url = nil
        errorText = nil
        start()
    }

    func fail(_ message: String) {
        errorText = "本机静态服务启动失败：\(message)"
        url = nil
        setIdleTimer(false)
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        if phase == .active {
            setIdleTimer(url != nil)
        } else {
            setIdleTimer(false)
        }
    }

    private func setIdleTimer(_ on: Bool) {
        UIApplication.shared.isIdleTimerDisabled = on
    }
}
