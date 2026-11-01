import SwiftUI

@main
struct DoudizhuApp: App {
    var body: some Scene {
        WindowGroup {
            LocalShellView()
                .preferredColorScheme(.light)
                .tint(ManorTheme.green)
        }
    }
}
