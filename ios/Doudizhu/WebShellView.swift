import SwiftUI
import UIKit
import WebKit

/// iOS 版当前直接复用浏览器前端，保证 UI 和功能与正式服完全一致。
/// 原生层负责服务器地址、保活和后续的本机牌桌 / AI / 蓝牙。
struct WebShellView: View {
    @StateObject private var model = WebShellModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            if let url = model.url {
                WebTableView(
                    url: url,
                    onLoading: { model.isLoading = true },
                    onReady: { model.isLoading = false },
                    onFailure: { model.fail($0) },
                    onSettings: { model.showSetup() }
                )
                .ignoresSafeArea()

                if model.isLoading {
                    LoadingOverlay {
                        model.showSetup()
                    }
                }
            } else {
                ServerSetupView(model: model)
            }
        }
        .preferredColorScheme(.light)
        .onAppear { model.applyIdleTimer() }
        .onChange(of: model.url) { _, _ in model.applyIdleTimer() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.applyIdleTimer()
            } else {
                model.setIdleTimer(false)
            }
        }
    }
}

@MainActor
final class WebShellModel: ObservableObject {
    @Published var serverText: String
    @Published var url: URL?
    @Published var isLoading = false
    @Published var errorText: String?

    private static let serverKey = "manor.serverURL"
    private static let defaultServer = "http://192.168.31.182:8000"

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey) ?? ""
        serverText = saved.isEmpty ? Self.defaultServer : saved
        if !saved.isEmpty, let savedURL = Self.normalizedURL(saved) {
            url = savedURL
            isLoading = true
        }
    }

    func connect() {
        guard let normalized = Self.normalizedURL(serverText) else {
            errorText = "地址格式不对，例如 http://192.168.31.182:8000"
            return
        }
        serverText = normalized.absoluteString
        UserDefaults.standard.set(normalized.absoluteString, forKey: Self.serverKey)
        errorText = nil
        isLoading = true
        url = normalized
    }

    func showSetup() {
        url = nil
        isLoading = false
        setIdleTimer(false)
    }

    func fail(_ message: String) {
        errorText = "连不上 \(serverText)：\(message)"
        url = nil
        isLoading = false
        setIdleTimer(false)
    }

    func setIdleTimer(_ on: Bool) {
        UIApplication.shared.isIdleTimerDisabled = on
    }

    func applyIdleTimer() {
        setIdleTimer(url != nil)
    }

    static func normalizedURL(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        let lower = text.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") {
            text = "http://" + text
        }
        guard var components = URLComponents(string: text), components.host != nil else {
            return nil
        }
        if components.path.isEmpty {
            components.path = "/"
        }
        return components.url
    }
}

private struct ServerSetupView: View {
    @ObservedObject var model: WebShellModel

    var body: some View {
        ZStack {
            ManorBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("MOLE MANOR · iOS")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .tracking(1.8)
                            .foregroundStyle(ManorTheme.greenDeep.opacity(0.72))
                        Text("同一张牌桌")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(ManorTheme.ink)
                        Text("界面与浏览器版完全一致，直接连家里电脑上的正式服。")
                            .font(.system(size: 14.5, weight: .medium, design: .rounded))
                            .foregroundStyle(ManorTheme.inkSoft)
                    }
                    .padding(.bottom, 2)

                    ManorCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("牌桌服务器")
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                                .foregroundStyle(ManorTheme.inkSoft)

                            TextField("http://192.168.31.182:8000", text: $model.serverText)
                                .textFieldStyle(.plain)
                                .font(.system(size: 18, weight: .semibold, design: .rounded))
                                .foregroundStyle(ManorTheme.ink)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .padding(.horizontal, 16)
                                .frame(height: 52)
                                .background(
                                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                                        .fill(ManorTheme.cream)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                                        .strokeBorder(ManorTheme.line.opacity(0.14), lineWidth: 1.5)
                                )

                            Button {
                                model.connect()
                            } label: {
                                Label("进入牌桌", systemImage: "play.fill")
                            }
                            .buttonStyle(ManorPrimaryButtonStyle(fill: ManorTheme.green))

                            Text("进入后三指轻点屏幕，可以回到这里更换服务器。")
                                .font(.system(size: 12.5, weight: .medium, design: .rounded))
                                .foregroundStyle(ManorTheme.inkFaint)
                        }
                    }

                    if let error = model.errorText {
                        ManorCard {
                            Text(error)
                                .font(.system(size: 13.5, weight: .medium, design: .rounded))
                                .foregroundStyle(ManorTheme.coral)
                        }
                    }

                    ManorCard {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("下一步")
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                                .foregroundStyle(ManorTheme.inkSoft)
                            Text("本机开桌、设备端 AI、同一房间蓝牙连接正在接入；现在先保证和浏览器版一模一样的牌桌体验。")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(ManorTheme.inkSoft)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Text("局域网直连 · 不上传云端 · v0.2.0")
                        .font(.system(size: 11.5, weight: .medium, design: .rounded))
                        .foregroundStyle(ManorTheme.inkFaint.opacity(0.85))
                        .padding(.horizontal, 4)
                }
                .frame(maxWidth: 720)
                .padding(.horizontal, 22)
                .padding(.vertical, 26)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }
}

private struct LoadingOverlay: View {
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            ManorTheme.cream.opacity(0.97)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .controlSize(.large)
                    .tint(ManorTheme.green)
                Text("正在进入庄园牌桌…")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(ManorTheme.inkSoft)
                Button("返回设置") {
                    onCancel()
                }
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(ManorTheme.coral)
            }
        }
    }
}

struct WebTableView: UIViewRepresentable {
    let url: URL
    let onLoading: () -> Void
    let onReady: () -> Void
    let onFailure: (String) -> Void
    let onSettings: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: "window.__MANOR_IOS__ = true;",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(ManorTheme.cream)
        webView.scrollView.backgroundColor = UIColor(ManorTheme.cream)
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.threeFingerTap)
        )
        tap.numberOfTouchesRequired = 3
        tap.cancelsTouchesInView = false
        webView.addGestureRecognizer(tap)

        context.coordinator.load(url, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.load(url, in: webView)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebTableView
        private var lastLoaded: URL?

        init(_ parent: WebTableView) {
            self.parent = parent
        }

        func load(_ url: URL, in webView: WKWebView) {
            guard lastLoaded != url else { return }
            lastLoaded = url
            parent.onLoading()
            webView.load(URLRequest(url: url))
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.onLoading()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.onReady()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.onFailure(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.onFailure(error.localizedDescription)
        }

        @objc func threeFingerTap() {
            parent.onSettings()
        }
    }
}
