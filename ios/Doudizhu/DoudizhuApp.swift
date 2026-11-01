import SwiftUI

@main
struct DoudizhuApp: App {
    var body: some Scene {
        WindowGroup {
            LobbyView()
                .preferredColorScheme(.light)
                .tint(ManorTheme.green)
        }
    }
}
