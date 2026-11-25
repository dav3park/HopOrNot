import SwiftUI

@main
struct HopOrNotApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                if model.stop == nil {
                    StopPickerView()
                } else {
                    StationView()
                }
            }
            .environment(model)
        }
    }
}
