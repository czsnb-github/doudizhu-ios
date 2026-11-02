import XCTest
import WebKit

/// 验证 iOS WKWebView 是否真的能用 RTCPeerConnection + RTCDataChannel。
/// 不依赖相机/麦克风，也不需要外网：两个本地 PeerConnection 互连发一条消息。
final class WebRTCCapabilityTests: XCTestCase, WKScriptMessageHandler {
    private var webView: WKWebView?
    private var window: UIWindow?
    private var done: XCTestExpectation?
    private var result: [String: Any]?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if let text = message.body as? String,
           let data = text.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data),
           let dict = object as? [String: Any] {
            result = dict
        } else if let object = message.body as? [String: Any] {
            result = object
        }
        done?.fulfill()
    }

    func testWebRTCDataChannel() {
        let expectation = expectation(description: "WKWebView WebRTC DataChannel")
        done = expectation
        DispatchQueue.main.async {
            let config = WKWebViewConfiguration()
            config.userContentController.add(self, name: "webrtcTest")
            let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
            self.webView = webView
            let window = UIWindow(frame: webView.frame)
            let controller = UIViewController()
            window.rootViewController = controller
            controller.view.addSubview(webView)
            window.makeKeyAndVisible()
            self.window = window
            webView.loadHTMLString(Self.html, baseURL: URL(string: "http://127.0.0.1:8765/"))
        }
        // CI 的模拟器冷启动 WebKit 内容进程可能要十几秒，25 秒会在页面脚本
        // 还没跑完时就判超时；页面内的 WebRTC 自检本身仍有 15 秒超时。
        wait(for: [expectation], timeout: 60)
        XCTAssertEqual(result?["ok"] as? Bool, true, "WKWebView WebRTC 失败: \(String(describing: result))")
        XCTAssertEqual(result?["message"] as? String, "ping")
    }

    override func tearDown() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "webrtcTest")
        webView?.stopLoading()
        window?.isHidden = true
        webView = nil
        window = nil
        done = nil
        result = nil
        super.tearDown()
    }

    private static let html = """
    <!doctype html><html><head><meta charset="utf-8"></head><body>
    <script>
    (async function () {
      function report(object) {
        try { window.webkit.messageHandlers.webrtcTest.postMessage(JSON.stringify(object)); } catch (e) {}
      }
      try {
        if (typeof RTCPeerConnection !== 'function' || typeof RTCDataChannel !== 'function') {
          report({ok: false, reason: 'RTCPeerConnection/RTCDataChannel unavailable'});
          return;
        }
        var pc1 = new RTCPeerConnection();
        var pc2 = new RTCPeerConnection();
        var timer = setTimeout(function () { report({ok: false, reason: 'timeout'}); }, 15000);
        pc1.onicecandidate = function (event) {
          if (event.candidate) pc2.addIceCandidate(event.candidate).catch(function () {});
        };
        pc2.onicecandidate = function (event) {
          if (event.candidate) pc1.addIceCandidate(event.candidate).catch(function () {});
        };
        var channel = pc1.createDataChannel('smoke');
        channel.onopen = function () { channel.send('ping'); };
        pc2.ondatachannel = function (event) {
          event.channel.onmessage = function (message) {
            clearTimeout(timer);
            report({ok: true, message: String(message.data), hasDataChannel: true});
            try { pc1.close(); pc2.close(); } catch (e) {}
          };
        };
        await pc1.setLocalDescription(await pc1.createOffer());
        await pc2.setRemoteDescription(pc1.localDescription);
        await pc2.setLocalDescription(await pc2.createAnswer());
        await pc1.setRemoteDescription(pc2.localDescription);
      } catch (e) {
        report({ok: false, reason: String(e && e.stack ? e.stack : e)});
      }
    })();
    </script></body></html>
    """
}
