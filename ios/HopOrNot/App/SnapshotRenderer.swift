#if DEBUG
import SwiftUI

/// 개발용: 실행 인자 -renderSnapshot 이 있으면 노선 화면 전체(고정 카드 + 스크롤 내용)를 긴 PNG 한 장으로 저장한다.
/// 탭 버튼(Picker)과 지도는 ImageRenderer로 그려지지 않는다.
@MainActor
enum SnapshotRenderer {
    static func renderIfRequested(model: AppModel, route: Route) {
        guard ProcessInfo.processInfo.arguments.contains("-renderSnapshot"), model.routeView != nil else { return }
        let content = VStack(spacing: 6) {
            PinnedDecision {}.padding(.horizontal, 12)
            RouteContent(route: route)
        }
        .environment(model)
        .frame(width: 402)
        .background(Theme.background)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 3
        guard let data = renderer.uiImage?.pngData() else { return }
        let url = FileManager.default.temporaryDirectory.appending(path: "station_snapshot.png")
        try? data.write(to: url)
        print("SNAPSHOT \(url.path)")
    }
}
#endif
