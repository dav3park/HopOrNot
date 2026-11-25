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

    static let directions = ["서울행", "영통행"]

    // 설정 (UserDefaults에 남긴다)
    var mode: Mode { didSet { defaults.set(mode.rawValue, forKey: "mode"); clearData(); routeView = nil } }
    var serverURL: String { didSet { defaults.set(serverURL, forKey: "serverURL") } }

    /// 노선 화면 경로 (NavigationStack). 마지막으로 본 노선이 있으면 그 노선 화면으로 시작한다.
    var path: [Route] = []
    private(set) var route: Route?
    private(set) var direction: String = "영통행"
    private(set) var stop: StopInfo?

    // 노선 화면 데이터
    private(set) var routeView: RouteView?
    // 내 정류장 데이터
    private(set) var prediction: Prediction?
    private(set) var line: LineView?
    private(set) var recommendation: Recommendation?
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    private let defaults = UserDefaults.standard

    init() {
        mode = Mode(rawValue: defaults.string(forKey: "mode") ?? "") ?? .demo
        serverURL = defaults.string(forKey: "serverURL") ?? "http://localhost:8000"
        if let raw = defaults.string(forKey: "route"), let route = Route(rawValue: raw) {
            self.route = route
            direction = defaults.string(forKey: "direction") ?? Self.defaultDirection
            if let data = defaults.data(forKey: "stop"), let stop = try? JSONDecoder().decode(StopInfo.self, from: data) {
                self.stop = stop
            }
            path = [route]
        }
        #if DEBUG
        // 개발용: -selectStop M5107,영통행,36,광교
        let arguments = ProcessInfo.processInfo.arguments
        if let i = arguments.firstIndex(of: "-selectStop"), i + 1 < arguments.count {
            let parts = arguments[i + 1].split(separator: ",").map(String.init)
            if parts.count == 4, let route = Route(rawValue: parts[0]), let seq = Int(parts[2]) {
                self.route = route
                direction = parts[1]
                stop = StopInfo(stationSeq: seq, stationName: parts[3], direction: parts[1], zone: nil)
                path = [route]
            }
        }
        #endif
    }

    /// 오전에는 출근(서울행), 오후에는 퇴근(영통행)
    static var defaultDirection: String { Calendar.current.component(.hour, from: .now) < 13 ? "서울행" : "영통행" }

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

    // MARK: 선택

    func open(_ route: Route) {
        if self.route != route {
            self.route = route
            direction = Self.defaultDirection
            stop = nil
            routeView = nil
            clearData()
            save()
        }
    }

    func setDirection(_ direction: String) {
        guard direction != self.direction else { return }
        self.direction = direction
        stop = nil
        routeView = nil
        clearData()
        save()
    }

    func select(_ stop: StopInfo) {
        guard stop.stationSeq != self.stop?.stationSeq else { return }
        self.stop = StopInfo(stationSeq: stop.stationSeq, stationName: stop.stationName, direction: direction, zone: stop.zone)
        clearData()
        save()
    }

    /// 추천 정류장으로 바꿀 때 (같은 노선·방향)
    func select(stationSeq: Int) {
        guard let target = routeView?.stops.first(where: { $0.stationSeq == stationSeq }) else { return }
        select(target.info)
    }

    private func save() {
        defaults.set(route?.rawValue, forKey: "route")
        defaults.set(direction, forKey: "direction")
        if let stop { defaults.set(try? JSONEncoder().encode(stop), forKey: "stop") } else { defaults.removeObject(forKey: "stop") }
    }

    private func clearData() {
        prediction = nil
        line = nil
        recommendation = nil
        errorMessage = nil
    }

    // MARK: 불러오기

    func refresh() async {
        guard let route else { return }
        isLoading = true
        defer { isLoading = false }
        let source = self.source, direction = self.direction, stop = self.stop
        do {
            let view = try await source.route(route, direction: direction)
            guard self.route == route, self.direction == direction else { return }
            routeView = view
            if let stop {
                async let p = source.predict(route: route, stationSeq: stop.stationSeq)
                async let l = source.line(route: route, stationSeq: stop.stationSeq)
                async let r = source.recommend(route: route, stationSeq: stop.stationSeq)
                let (prediction, line, recommendation) = try await (p, l, r)
                // 기다리는 사이 다른 정류장을 골랐으면 버린다
                guard self.stop?.stationSeq == stop.stationSeq else { return }
                self.prediction = prediction
                self.line = line
                self.recommendation = recommendation
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
