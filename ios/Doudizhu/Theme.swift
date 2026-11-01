import SwiftUI

enum ManorTheme {
    static let cream = Color(red: 0.992, green: 0.965, blue: 0.902)
    static let paper = Color(red: 1.000, green: 0.980, blue: 0.941)
    static let ink = Color(red: 0.231, green: 0.188, blue: 0.149)
    static let inkSoft = Color(red: 0.490, green: 0.416, blue: 0.333)
    static let inkFaint = Color(red: 0.659, green: 0.592, blue: 0.498)
    static let green = Color(red: 0.310, green: 0.490, blue: 0.341)
    static let greenDeep = Color(red: 0.184, green: 0.322, blue: 0.239)
    static let leaf = Color(red: 0.498, green: 0.682, blue: 0.455)
    static let coral = Color(red: 0.914, green: 0.482, blue: 0.424)
    static let gold = Color(red: 0.914, green: 0.722, blue: 0.306)
    static let wood = Color(red: 0.698, green: 0.478, blue: 0.314)
    static let woodDeep = Color(red: 0.486, green: 0.298, blue: 0.192)
    static let line = Color(red: 0.431, green: 0.325, blue: 0.231)
    static let shadow = Color.black.opacity(0.16)

    static let cardRadius: CGFloat = 18
    static let panelRadius: CGFloat = 26

    static let panelShadow = Color(red: 0.357, green: 0.243, blue: 0.153).opacity(0.18)
}

struct ManorCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                // 阴影只挂在背景形状上；挂在整张卡上会让卡内文字出现重影。
                RoundedRectangle(cornerRadius: ManorTheme.panelRadius, style: .continuous)
                    .fill(ManorTheme.paper)
                    .shadow(color: ManorTheme.panelShadow, radius: 0, x: 0, y: 6)
                    .shadow(color: ManorTheme.shadow, radius: 22, x: 0, y: 14)
            )
            .overlay(
                RoundedRectangle(cornerRadius: ManorTheme.panelRadius, style: .continuous)
                    .strokeBorder(ManorTheme.line.opacity(0.18), lineWidth: 1.5)
            )
    }
}

struct ManorPrimaryButtonStyle: ButtonStyle {
    var fill: Color = ManorTheme.coral

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 18, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(configuration.isPressed ? fill.opacity(0.82) : fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.28), lineWidth: 1)
            )
            .shadow(color: fill.opacity(0.28), radius: 0, x: 0, y: 4)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct ManorSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold, design: .rounded))
            .foregroundStyle(ManorTheme.greenDeep)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .fill(ManorTheme.leaf.opacity(configuration.isPressed ? 0.26 : 0.16))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .strokeBorder(ManorTheme.green.opacity(0.28), lineWidth: 1.5)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

struct SeatChip: View {
    let name: String
    var filled: Bool = true

    private var initial: String {
        String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1))
    }

    var body: some View {
        HStack(spacing: 9) {
            ZStack {
                Circle()
                    .fill(filled ? ManorTheme.green : ManorTheme.inkFaint.opacity(0.25))
                Text(initial.isEmpty ? "?" : initial)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .frame(width: 34, height: 34)

            Text(name)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(filled ? ManorTheme.ink : ManorTheme.inkSoft)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            Capsule().fill(ManorTheme.cream)
        )
        .overlay(
            Capsule().strokeBorder(ManorTheme.line.opacity(0.12), lineWidth: 1)
        )
    }
}
