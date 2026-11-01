import SwiftUI

@main
struct DoudizhuApp: App {
    var body: some Scene {
        WindowGroup {
            WebShellView()
                .preferredColorScheme(.light)
                .tint(ManorTheme.green)
        }
    }
}
