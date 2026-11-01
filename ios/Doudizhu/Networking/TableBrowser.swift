import Foundation
import Network

/// 客户端端：用 Bonjour 找同一 Wi-Fi 下正在开的牌桌。
final class TableBrowser {
    struct Table: Identifiable {
        let id: String
        let name: String
        let endpoint: NWEndpoint
    }

    var onUpdate: (([Table]) -> Void)?
    var onError: ((String) -> Void)?

    private var browser: NWBrowser?
    private var results: [NWBrowser.Result] = []

    func start() {
        stop()
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        let browser = NWBrowser(
            for: .bonjour(type: "_doudizhu._tcp", domain: nil),
            using: parameters
        )
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.results = Array(results)
                self.publish()
            }
        }
        browser.stateUpdateHandler = { [weak self] state in
            if case .failed(let error) = state {
                DispatchQueue.main.async {
                    self?.onError?("查找牌桌失败：\(error.localizedDescription)")
                }
            }
        }
        self.browser = browser
        browser.start(queue: .main)
    }

    func stop() {
        browser?.browseResultsChangedHandler = nil
        browser?.stateUpdateHandler = nil
        browser?.cancel()
        browser = nil
        results.removeAll()
    }

    private func publish() {
        let tables = results.compactMap { result -> Table? in
            guard case let .service(name, _, _, _) = result.endpoint else { return nil }
            return Table(
                id: String(describing: result.endpoint),
                name: name,
                endpoint: result.endpoint
            )
        }
        .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }

        if Thread.isMainThread {
            onUpdate?(tables)
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.onUpdate?(tables)
            }
        }
    }
}
