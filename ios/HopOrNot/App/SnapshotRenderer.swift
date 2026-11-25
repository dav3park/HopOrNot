#if DEBUG
import SwiftUI

/// 개발용: 실행 인자 -renderSnapshot 이 있으면 정류장 화면 전체(스크롤 포함)를 긴 PNG 한 장으로 저장한다.
/// 지도(MapKit)는 ImageRenderer로 그려지지 않으므로 노선도 보기로 저장한다.
@MainActor
enum SnapshotRenderer {
    static func renderIfRequested(model: AppModel) {
        guard ProcessInfo.processInfo.arguments.contains("-renderSnapshot"), model.prediction != nil else { return }
        let content = StationContent(view: .constant(.strip))
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
