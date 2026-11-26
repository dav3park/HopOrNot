import SwiftUI

@main
struct HopOrNotApp: App {
    @State private var model = AppModel()
    @State private var showSplash = HopOrNotApp.shouldShowSplash

    /// 개발용 인자로 곧바로 정류장·목록을 여는 경우에는 스플래시를 건너뛴다 (-splashAt 으로 강제 가능)
    private static var shouldShowSplash: Bool {
        #if DEBUG
        let launch = ProcessInfo.processInfo.arguments
        if launch.contains("-splashAt") { return true }
        if launch.contains("-noSplash") || launch.contains("-selectStop") || launch.contains("-openRoute") { return false }
        #endif
        return true
    }

    var body: some Scene {
        WindowGroup {
            @Bindable var model = model
            ZStack {
                NavigationStack(path: $model.path) {
                    HomeView()
                        .navigationDestination(for: Screen.self) { screen in
                            switch screen {
                            case .route(let route): RouteScreen(route: route)
                            case .station: StationView()
                            }
                        }
                }
                if showSplash {
                    SplashView { showSplash = false }
                        .zIndex(1)
                }
            }
            .environment(model)
            .preferredColorScheme(.light)
            .tint(Brand.ink)
        }
    }
}
