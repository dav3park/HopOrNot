import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum Mode: String, CaseIterable, Identifiable {
        case demo, live
        var id: String { rawValue }
        var label: String { self == .demo ? "데모 (과거 실제 데이터)" : "추론 서버" }
    }

    // 설정 (UserDefaults에 남긴다)
    var mode: Mode { didSet { defaults.set(mode.rawValue, forKey: "mode"); clearData() } }
    var serverURL: String { didSet { defaults.set(serverURL, forKey: "serverURL") } }
    private(set) var route: Route?
    private(set) var stop: StopInfo?

    // 정류장 화면 데이터
    private(set) var prediction: Prediction?
    private(set) var line: LineView?
    private(set) var recommendation: Recommendation?
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    private let defaults = UserDefaults.standard

    init() {
        mode = Mode(rawValue: defaults.string(forKey: "mode") ?? "") ?? .demo
        serverURL = defaults.string(forKey: "serverURL") ?? "http://localhost:8000"
        if let raw = defaults.string(forKey: "route"), let route = Route(rawValue: raw),
           let data = defaults.data(forKey: "stop"), let stop = try? JSONDecoder().decode(StopInfo.self, from: data) {
            self.route = route
            self.stop = stop
        }
    }

    var source: DataSource {
        switch mode {
        case .demo: DemoSource()
        case .live: LiveSource(baseURL: URL(string: serverURL) ?? URL(string: "http://localhost:8000")!)
        }
    }

    var dataLabel: String {
        switch mode {
        case .demo: "데모 · \(DemoSource.meta?.label ?? "과거 데이터")"
        case .live: "실시간"
        }
    }

    var decision: Decision { Decision(prediction: prediction, recommendation: recommendation, stop: stop) }

    func select(route: Route, stop: StopInfo) {
        self.route = route
        self.stop = stop
        defaults.set(route.rawValue, forKey: "route")
        defaults.set(try? JSONEncoder().encode(stop), forKey: "stop")
        clearData()
    }

    /// 추천 정류장으로 바꿀 때: 같은 노선의 정류장 목록에서 찾는다
    func switchStop(to seq: Int) async {
        guard let route, let stops = try? await source.stops(route: route),
              let target = stops.first(where: { $0.stationSeq == seq }) else { return }
        select(route: route, stop: target)
        await refresh()
    }

    func clearSelection() {
        route = nil
        stop = nil
        defaults.removeObject(forKey: "route")
        defaults.removeObject(forKey: "stop")
        clearData()
    }

    private func clearData() {
        prediction = nil
        line = nil
        recommendation = nil
        errorMessage = nil
    }

    func refresh() async {
        guard let route, let stop else { return }
        isLoading = true
        defer { isLoading = false }
        let source = self.source
        do {
            async let p = source.predict(route: route, stationSeq: stop.stationSeq)
            async let l = source.line(route: route, stationSeq: stop.stationSeq)
            async let r = source.recommend(route: route, stationSeq: stop.stationSeq)
            let (prediction, line, recommendation) = try await (p, l, r)
            // 기다리는 사이 다른 정류장을 골랐으면 버린다
            guard self.stop?.stationSeq == stop.stationSeq, self.route == route else { return }
            self.prediction = prediction
            self.line = line
            self.recommendation = recommendation
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
