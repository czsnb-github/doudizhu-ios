import SwiftUI

struct LobbyView: View {
    @StateObject private var model = LobbyModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            ManorBackground()

            if model.inTable {
                TablePlaceholderView(title: model.tableTitle, names: model.tableNames) {
                    model.backToLobby()
                }
                .transition(.opacity)
            } else {
                lobby
            }
        }
        .animation(.easeInOut(duration: 0.22), value: model.inTable)
        .alert("提示", isPresented: Binding(
            get: { model.alertText != nil },
            set: { if !$0 { model.alertText = nil } }
        )) {
            Button("知道了", role: .cancel) { model.alertText = nil }
        } message: {
            Text(model.alertText ?? "")
        }
        .onChange(of: scenePhase) { _, newPhase in
            model.scenePhaseChanged(newPhase)
        }
    }

    private var lobby: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                nameCard
                actionCard
                if model.phase == .browsing {
                    nearbyCard
                }
                footer
            }
            .frame(maxWidth: 760)
            .padding(.horizontal, 22)
            .padding(.vertical, 26)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text("MOLE MANOR · 牌桌")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .tracking(1.8)
                    .foregroundStyle(ManorTheme.greenDeep.opacity(0.72))
                Spacer()
                HStack(spacing: 7) {
                    Image(systemName: "suit.spade.fill")
                    Image(systemName: "suit.heart.fill")
                    Image(systemName: "suit.club.fill")
                    Image(systemName: "suit.diamond.fill")
                }
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(ManorTheme.coral)
            }

            Text("回庄园，打一局斗地主")
                .font(.system(size: 31, weight: .bold, design: .rounded))
                .foregroundStyle(ManorTheme.ink)
                .minimumScaleFactor(0.8)

            Text("同一张 Wi-Fi 牌桌 · 每台 iPad 都能开桌")
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(ManorTheme.inkSoft)
        }
        .padding(.bottom, 2)
    }

    private var nameCard: some View {
        ManorCard {
            VStack(alignment: .leading, spacing: 11) {
                Text("你的名字")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(ManorTheme.inkSoft)

                TextField("比如：猫猫", text: $model.name)
                    .textFieldStyle(.plain)
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundStyle(ManorTheme.ink)
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
                    .disabled(model.phase != .idle)
                    .opacity(model.phase == .idle ? 1 : 0.65)

                Text("只认名字，不设密码；先留在这台设备上。")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .foregroundStyle(ManorTheme.inkFaint)
            }
        }
    }

    private var actionCard: some View {
        ManorCard {
            VStack(alignment: .leading, spacing: 15) {
                HStack(spacing: 9) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 9, height: 9)
                    Text(model.statusLine)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(ManorTheme.inkSoft)
                    Spacer()
                }

                buttons

                if !model.tableNames.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("桌边")
                            .font(.system(size: 12.5, weight: .bold, design: .rounded))
                            .foregroundStyle(ManorTheme.inkFaint)
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 116), spacing: 8)],
                            alignment: .leading,
                            spacing: 8
                        ) {
                            ForEach(model.tableNames.indices, id: \.self) { index in
                                SeatChip(name: model.tableNames[index], filled: index == 0)
                            }
                        }
                    }
                }

                if model.phase == .hosting {
                    Text("开桌的这台设备要保持前台亮屏；锁屏或切后台，牌桌会暂停。")
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(ManorTheme.coral.opacity(0.9))
                }
            }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        switch model.phase {
        case .idle:
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { hostButton; browseButton }
                VStack(spacing: 10) { hostButton; browseButton }
            }
        case .hosting:
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { enterButton; closeHostButton }
                VStack(spacing: 10) { enterButton; closeHostButton }
            }
        case .browsing:
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { ProgressView().tint(ManorTheme.green); stopBrowseButton }
                VStack(spacing: 10) { stopBrowseButton }
            }
        case .connecting:
            HStack(spacing: 12) {
                ProgressView().tint(ManorTheme.green)
                Text("正在连接…")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(ManorTheme.inkSoft)
                Spacer()
                Button("取消") { model.leaveAll() }
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(ManorTheme.coral)
            }
            .frame(height: 52)
        case .connected:
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { enterButton; leaveButton }
                VStack(spacing: 10) { enterButton; leaveButton }
            }
        }
    }

    private var hostButton: some View {
        Button {
            model.hostTable()
        } label: {
            Label("开一桌", systemImage: "plus.circle.fill")
        }
        .buttonStyle(ManorPrimaryButtonStyle())
        .disabled(model.phase == .connecting)
    }

    private var browseButton: some View {
        Button {
            model.findTables()
        } label: {
            Label("找牌桌", systemImage: "magnifyingglass")
        }
        .buttonStyle(ManorSecondaryButtonStyle())
        .disabled(model.phase == .connecting)
    }

    private var enterButton: some View {
        Button {
            model.enterTable()
        } label: {
            Label("进入牌桌", systemImage: "play.fill")
        }
        .buttonStyle(ManorPrimaryButtonStyle(fill: ManorTheme.green))
    }

    private var closeHostButton: some View {
        Button("关闭牌桌") { model.closeTable() }
            .buttonStyle(ManorSecondaryButtonStyle())
    }

    private var stopBrowseButton: some View {
        Button("停止查找") { model.stopBrowsing() }
            .buttonStyle(ManorSecondaryButtonStyle())
    }

    private var leaveButton: some View {
        Button("离开牌桌") { model.leaveAll() }
            .buttonStyle(ManorSecondaryButtonStyle())
    }

    private var nearbyCard: some View {
        ManorCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("附近的牌桌")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(ManorTheme.ink)
                    Spacer()
                    Text("同一 Wi-Fi")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(ManorTheme.inkFaint)
                }

                if model.tables.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView().tint(ManorTheme.green)
                        Text("正在找… 确认对方已经点了“开一桌”。")
                            .font(.system(size: 13.5, weight: .medium, design: .rounded))
                            .foregroundStyle(ManorTheme.inkSoft)
                    }
                    .padding(.vertical, 8)
                } else {
                    ForEach(model.tables) { table in
                        HStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(ManorTheme.leaf.opacity(0.18))
                                Image(systemName: "person.3.fill")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(ManorTheme.greenDeep)
                            }
                            .frame(width: 42, height: 42)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(table.name)
                                    .font(.system(size: 15.5, weight: .bold, design: .rounded))
                                    .foregroundStyle(ManorTheme.ink)
                                    .lineLimit(1)
                                Text("点一下加入")
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .foregroundStyle(ManorTheme.inkFaint)
                            }

                            Spacer()

                            Button("加入") { model.join(table) }
                                .font(.system(size: 14.5, weight: .bold, design: .rounded))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 17)
                                .padding(.vertical, 9)
                                .background(Capsule().fill(ManorTheme.green))
                                .buttonStyle(.plain)
                        }
                        .padding(10)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(ManorTheme.cream)
                        )
                    }
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            Text("局域网直连 · 不上传云端")
            Spacer()
            Text("v0.1.0")
        }
        .font(.system(size: 11.5, weight: .medium, design: .rounded))
        .foregroundStyle(ManorTheme.inkFaint.opacity(0.85))
        .padding(.horizontal, 4)
        .padding(.top, 2)
    }

    private var statusColor: Color {
        switch model.phase {
        case .idle:
            return ManorTheme.inkFaint.opacity(0.5)
        case .hosting, .connected:
            return ManorTheme.leaf
        case .browsing, .connecting:
            return ManorTheme.gold
        }
    }
}

private struct ManorBackground: View {
    var body: some View {
        GeometryReader { geo in
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.64, green: 0.82, blue: 0.88),
                        ManorTheme.cream,
                        Color(red: 0.95, green: 0.91, blue: 0.80)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                Circle()
                    .fill(ManorTheme.leaf.opacity(0.14))
                    .frame(width: 460, height: 460)
                    .offset(x: -geo.size.width * 0.25, y: -geo.size.height * 0.28)

                Circle()
                    .fill(ManorTheme.gold.opacity(0.12))
                    .frame(width: 360, height: 360)
                    .offset(x: geo.size.width * 0.30, y: geo.size.height * 0.28)

                Circle()
                    .fill(Color.white.opacity(0.18))
                    .frame(width: 220, height: 220)
                    .offset(x: geo.size.width * 0.25, y: -geo.size.height * 0.30)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .ignoresSafeArea()
    }
}

struct TablePlaceholderView: View {
    let title: String
    let names: [String]
    let onBack: () -> Void

    private var seats: [String] {
        Array(names.prefix(3))
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [ManorTheme.greenDeep, Color(red: 0.22, green: 0.42, blue: 0.30)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                GeometryReader { geo in
                    let tableWidth = min(geo.size.width * 0.86, 900)
                    let tableHeight = min(geo.size.height * 0.60, 430)

                    ZStack {
                        RoundedRectangle(cornerRadius: 44, style: .continuous)
                            .fill(ManorTheme.wood)
                            .frame(width: tableWidth, height: tableHeight)
                            .shadow(color: .black.opacity(0.28), radius: 22, x: 0, y: 16)

                        RoundedRectangle(cornerRadius: 34, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [ManorTheme.green, ManorTheme.greenDeep],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .padding(11)
                            .frame(width: tableWidth, height: tableHeight)

                        RoundedRectangle(cornerRadius: 26, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.12), lineWidth: 1.5)
                            .padding(24)
                            .frame(width: tableWidth, height: tableHeight)

                        VStack(spacing: 7) {
                            Text("等待开局")
                                .font(.system(size: 24, weight: .bold, design: .rounded))
                                .foregroundStyle(.white.opacity(0.92))
                            Text("牌桌同步已连通")
                                .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                                .foregroundStyle(.white.opacity(0.55))
                            Text("规则 / 叫抢 / AI 正在移植")
                                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                                .foregroundStyle(.white.opacity(0.38))
                        }

                        seat(name: seats.indices.contains(0) ? seats[0] : "房主")
                            .offset(y: -tableHeight / 2 + 30)
                        seat(name: seats.indices.contains(1) ? seats[1] : "等家人")
                            .offset(x: -tableWidth / 2 + 58)
                        seat(name: seats.indices.contains(2) ? seats[2] : "等家人")
                            .offset(x: tableWidth / 2 - 58)
                        seat(name: "你", highlight: true)
                            .offset(y: tableHeight / 2 - 30)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                handPreview
            }
        }
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            Button {
                onBack()
            } label: {
                Label("大厅", systemImage: "chevron.left")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(Color.white.opacity(0.12)))
            }
            .buttonStyle(.plain)

            Text(title)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.94))

            Spacer()

            Label("局域网", systemImage: "wifi")
                .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().fill(Color.white.opacity(0.10)))
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
    }

    private var handPreview: some View {
        VStack(spacing: 8) {
            HStack(spacing: -16) {
                ForEach(0..<7, id: \.self) { _ in
                    CardBack()
                }
            }
            Text("手牌区")
                .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.38))
        }
        .padding(.bottom, 18)
    }

    private func seat(name: String, highlight: Bool = false) -> some View {
        HStack(spacing: 7) {
            ZStack {
                Circle()
                    .fill(highlight ? ManorTheme.gold : Color.white.opacity(0.18))
                Text(String(name.prefix(1)))
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(highlight ? ManorTheme.ink : .white)
            }
            .frame(width: 30, height: 30)

            Text(name)
                .font(.system(size: 13.5, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Capsule().fill(Color.black.opacity(0.22)))
    }
}

private struct CardBack: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [ManorTheme.green, ManorTheme.greenDeep],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: 44, height: 62)
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.55), lineWidth: 1.5)
            )
            .overlay(
                Text("斗")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.7))
            )
            .shadow(color: .black.opacity(0.22), radius: 4, x: 0, y: 3)
    }
}
