import SwiftUI

@main
struct HopOrNotApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            @Bindable var model = model
            NavigationStack(path: $model.path) {
                StopPickerView()
                    .navigationDestination(for: Screen.self) { screen in
                        switch screen {
                        case .route(let route): RouteScreen(route: route)
                        case .station: StationView()
                        }
                    }
            }
            .environment(model)
        }
    }
}
