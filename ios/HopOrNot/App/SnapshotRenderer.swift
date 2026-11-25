#if DEBUG
import SwiftUI

/// 개발용: 실행 인자 -renderSnapshot 이 있으면 화면 전체(스크롤 포함)를 긴 PNG 한 장으로 저장한다.
/// 탭 버튼(Picker)과 지도는 ImageRenderer로 그려지지 않는다.
@MainActor
enum SnapshotRenderer {
    static func renderStationIfRequested(model: AppModel) {
        guard model.prediction != nil, model.history != nil else { return }
        render(StationContent(view: .constant(.strip)), model: model, name: "station_snapshot")
    }

    static func renderRouteIfRequested(model: AppModel, route: Route) {
        guard model.routeView != nil, model.path.last == .route(route) else { return }
        render(RouteContent(route: route), model: model, name: "route_snapshot")
    }

    private static func render(_ view: some View, model: AppModel, name: String) {
        guard ProcessInfo.processInfo.arguments.contains("-renderSnapshot") else { return }
        let content = view.environment(model).frame(width: 402).background(Theme.background)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 3
        guard let data = renderer.uiImage?.pngData() else { return }
        let url = FileManager.default.temporaryDirectory.appending(path: "\(name).png")
        try? data.write(to: url)
        print("SNAPSHOT \(url.path)")
    }
}
#endif
