import Foundation
import SwiftUI
import UIKit
import Network

@MainActor
final class LobbyModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case hosting
        case browsing
        case connecting
        case connected
    }

    @Published var name: String {
        didSet { UserDefaults.standard.set(name, forKey: Self.nameKey) }
    }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var hostStatus = TableHost.Status()
    @Published private(set) var clientStatus = TableClient.Status()
    @Published private(set) var tables: [TableBrowser.Table] = []
    @Published private(set) var inTable = false
    @Published var alertText: String?

    private static let nameKey = "manor.playerName"
    private var host: TableHost?
    private var client: TableClient?
    private var browser: TableBrowser?
    private var endpoints: [String: NWEndpoint] = [:]

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.nameKey) ?? ""
        name = saved.isEmpty ? "小摩尔" : saved
    }

    var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var canStart: Bool {
        !trimmedName.isEmpty && phase != .connecting
    }

    var statusLine: String {
        switch phase {
        case .idle:
            return "开一桌，或加入家人的牌桌"
        case .hosting:
            return hostStatus.port == 0
                ? "正在开桌…"
                : "牌桌已开 · 端口 \(hostStatus.port)"
        case .browsing:
            return tables.isEmpty
                ? "正在同一 Wi-Fi 下找牌桌…"
                : "找到 \(tables.count) 张牌桌"
        case .connecting:
            return "正在连过去…"
        case .connected:
            return clientStatus.hostName.isEmpty
                ? "已连上牌桌"
                : "已连上 \(clientStatus.hostName) 的牌桌"
        }
    }

    var tableNames: [String] {
        switch phase {
        case .hosting:
            return hostStatus.names.isEmpty ? [trimmedName] : hostStatus.names
        case .connected:
            return clientStatus.peers.isEmpty ? [trimmedName] : clientStatus.peers
        default:
            return []
        }
    }

    var tableTitle: String {
        switch phase {
        case .hosting:
            return "\(trimmedName) 的牌桌"
        case .connected:
            return clientStatus.hostName.isEmpty ? "家人的牌桌" : "\(clientStatus.hostName) 的牌桌"
        default:
            return "庄园牌桌"
        }
    }

    func hostTable() {
        guard canStart else {
            alertText = trimmedName.isEmpty ? "先给自己起个名字" : "正在连接，稍等一下"
            return
        }
        leaveAll()
        phase = .hosting
        stayAwake(true)

        let host = TableHost(hostName: trimmedName)
        host.onUpdate = { [weak self] status in
            guard let self else { return }
            self.hostStatus = status
            if let error = status.error {
                self.alertText = error
                self.phase = .idle
                self.inTable = false
                self.stayAwake(false)
                self.host?.stop()
                self.host = nil
            }
        }
        self.host = host
        host.start()
    }

    func findTables() {
        guard canStart else {
            alertText = trimmedName.isEmpty ? "先给自己起个名字" : "正在连接，稍等一下"
            return
        }
        leaveAll()
        phase = .browsing

        let browser = TableBrowser()
        browser.onUpdate = { [weak self] tables in
            guard let self else { return }
            self.tables = tables
            self.endpoints = Dictionary(uniqueKeysWithValues: tables.map { ($0.id, $0.endpoint) })
        }
        browser.onError = { [weak self] text in
            self?.alertText = text
        }
        self.browser = browser
        browser.start()
    }

    func stopBrowsing() {
        browser?.stop()
        browser = nil
        tables = []
        endpoints.removeAll()
        if phase == .browsing {
            phase = .idle
        }
    }

    func join(_ table: TableBrowser.Table) {
        guard canStart else { return }
        guard let endpoint = endpoints[table.id] else {
            alertText = "这张牌桌已经关了，重新找一下"
            return
        }
        stopBrowsing()
        phase = .connecting
        stayAwake(true)

        let client = TableClient(myName: trimmedName)
        client.onUpdate = { [weak self] status in
            guard let self else { return }
            self.clientStatus = status
            if status.connected {
                self.phase = .connected
            }
            if let error = status.error {
                self.alertText = error
                self.phase = .idle
                self.inTable = false
                self.stayAwake(false)
                self.client?.disconnect()
                self.client = nil
            }
        }
        self.client = client
        client.connect(to: endpoint)
    }

    func enterTable() {
        guard phase == .hosting || phase == .connected else { return }
        inTable = true
    }

    func backToLobby() {
        inTable = false
    }

    func leaveAll() {
        host?.stop()
        host = nil
        client?.disconnect()
        client = nil
        browser?.stop()
        browser = nil
        hostStatus = TableHost.Status()
        clientStatus = TableClient.Status()
        tables = []
        endpoints.removeAll()
        phase = .idle
        inTable = false
        stayAwake(false)
    }

    func closeTable() {
        leaveAll()
    }

    func scenePhaseChanged(_ scenePhase: ScenePhase) {
        switch scenePhase {
        case .active:
            stayAwake(phase == .hosting || phase == .connected)
        case .background, .inactive:
            stayAwake(false)
        @unknown default:
            break
        }
    }

    private func stayAwake(_ on: Bool) {
        UIApplication.shared.isIdleTimerDisabled = on
    }
}
