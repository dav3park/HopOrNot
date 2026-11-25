import SwiftUI

@main
struct HopOrNotApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            @Bindable var model = model
            NavigationStack(path: $model.path) {
                StopPickerView()
                    .navigationDestination(for: Route.self) { RouteScreen(route: $0) }
            }
            .environment(model)
        }
    }
}
