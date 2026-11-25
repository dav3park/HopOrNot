import Foundation
import Observation
import SwiftUI

/// 화면 이동: 노선 선택 → 정류장 목록(노선 한 바퀴) → 정류장
enum Screen: Hashable {
    case route(Route)
    case station
}

@MainActor
@Observable
final class AppModel {
    enum Mode: String, CaseIterable, Identifiable {
        case demo, live
        var id: String { rawValue }
        var label: String { self == .demo ? "데모 (과거 실제 데이터)" : "추론 서버" }
    }

    // 설정 (UserDefaults에 남긴다)
    var mode: Mode { didSet { defaults.set(mode.rawValue, forKey: "mode"); clearStopData(); routeView = nil; replayIndex = 0 } }
    var serverURL: String { didSet { defaults.set(serverURL, forKey: "serverURL") } }
    /// 추론 서버 접근 키 (서버 .env 의 API_KEY)
    var apiKey: String { didSet { defaults.set(apiKey, forKey: "apiKey") } }

    var path: [Screen] = []
    private(set) var route: Route?
    private(set) var stop: StopInfo?

    // 정류장 목록·지도 데이터 (노선마다 한 번)
    private(set) var routeView: RouteView?
    private(set) var geometry: RoutePath?
    private(set) var replayLabel: String?
    // 정류장 화면 데이터
    private(set) var prediction: Prediction?
    private(set) var line: LineView?
    private(set) var recommendation: Recommendation?
    private(set) var history: History?
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    private let defaults = UserDefaults.standard
    private var replayIndex = 0

    /// 빌드할 때 Config/Secrets.xcconfig 에서 들어온 접근 키 (없으면 빈 문자열)
    static var bundledKey: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "HopOrNotAPIKey") as? String ?? ""
        return value.contains("$(") ? "" : value
    }

    init() {
        // 키가 앱에 들어 있으면 처음부터 실서버로, 없으면 데모로 시작한다
        mode = Mode(rawValue: defaults.string(forKey: "mode") ?? "") ?? (Self.bundledKey.isEmpty ? .demo : .live)
        serverURL = defaults.string(forKey: "serverURL") ?? "https://54-116-10-20.sslip.io"
        // 설정에서 직접 넣은 키가 있으면 그것을, 없으면 빌드에 들어온 키를
        let stored = defaults.string(forKey: "apiKey") ?? ""
        apiKey = stored.isEmpty ? Self.bundledKey : stored
        #if DEBUG
        // 개발용: -live URL,KEY 로 실서버 모드로 시작
        let launch = ProcessInfo.processInfo.arguments
        if let i = launch.firstIndex(of: "-live"), i + 1 < launch.count {
            let parts = launch[i + 1].split(separator: ",", maxSplits: 1).map(String.init)
            mode = .live
            serverURL = parts[0]
            if parts.count > 1 { apiKey = parts[1] }
        }
        #endif
        if let raw = defaults.string(forKey: "route"), let route = Route(rawValue: raw) {
            self.route = route
            path = [.route(route)]
            if let data = defaults.data(forKey: "stop"), let stop = try? JSONDecoder().decode(StopInfo.self, from: data) {
                self.stop = stop
                path.append(.station)
            }
        }
        #if DEBUG
        // 개발용: -selectStop M5107,36,광교 (정류장 화면으로 시작), -openRoute M5107 (정류장 목록으로 시작)
        let arguments = ProcessInfo.processInfo.arguments
        func value(_ flag: String) -> [String]? {
            guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
            return arguments[i + 1].split(separator: ",").map(String.init)
        }
        if let parts = value("-selectStop"), parts.count == 3, let route = Route(rawValue: parts[0]), let seq = Int(parts[1]) {
            self.route = route
            stop = StopInfo(stationSeq: seq, stationName: parts[2], direction: nil, zone: nil)
            path = [.route(route), .station]
        } else if let parts = value("-openRoute"), parts.count == 1, let route = Route(rawValue: parts[0]) {
            self.route = route
            stop = nil
            path = [.route(route)]
        }
        #endif
    }

    /// 오전에는 출근(서울행), 오후에는 퇴근(영통행): 정류장 목록을 처음 열 때 이쪽 정류장으로 스크롤한다
    static var defaultDirection: String { Calendar.current.component(.hour, from: .now) < 13 ? "서울행" : "영통행" }

    var source: DataSource {
        switch mode {
        case .demo: DemoSource()
        case .live: LiveSource(baseURL: URL(string: serverURL) ?? URL(string: "http://localhost:8000")!, apiKey: apiKey)
        }
    }

    var dataLabel: String {
        switch mode {
        case .demo: "데모 · \(DemoSource.meta?.label ?? "과거 데이터")"
        case .live: "실시간"
        }
    }

    var decision: Decision { Decision(prediction: prediction, recommendation: recommendation, stop: stop) }

    /// 정류장 목록을 처음 열 때 스크롤할 정류장 (고른 정류장, 없으면 지금 시간대 방향의 첫 정류장)
    var scrollTargetSeq: Int? {
        if let stop, routeView?.stops.contains(where: { $0.stationSeq == stop.stationSeq }) == true { return stop.stationSeq }
        return routeView?.stops.first { $0.isTarget && $0.direction == Self.defaultDirection }?.stationSeq
    }

    // MARK: 선택

    func open(_ route: Route) {
        guard self.route != route else { return }
        self.route = route
        stop = nil
        routeView = nil
        geometry = nil
        replayIndex = 0
        clearStopData()
        save()
    }

    /// 정류장 목록에서 정류장을 누르면 정류장 화면으로
    func openStation(_ stop: StopInfo) {
        if stop.stationSeq != self.stop?.stationSeq {
            self.stop = stop
            clearStopData()
            save()
        }
        path.append(.station)
    }

    /// 정류장 화면 안에서 추천 정류장으로 바꿀 때
    func switchStop(to seq: Int) async {
        guard let target = routeView?.stops.first(where: { $0.stationSeq == seq }) else { return }
        stop = target.info
        clearStopData()
        save()
        await refreshStop()
    }

    private func save() {
        defaults.set(route?.rawValue, forKey: "route")
        if let stop { defaults.set(try? JSONEncoder().encode(stop), forKey: "stop") } else { defaults.removeObject(forKey: "stop") }
    }

    private func clearStopData() {
        prediction = nil
        line = nil
        recommendation = nil
        history = nil
        errorMessage = nil
    }

    // MARK: 불러오기

    /// 정류장 목록. 버스 위치가 바뀌면 레일 위에서 움직이도록 애니메이션으로 바꾼다.
    /// 데모는 저장해 둔 2분 간격 장면을 차례로 보여준다 (재생).
    func refreshRoute() async {
        guard let route else { return }
        do {
            let view: RouteView
            if mode == .demo, let frames = DemoSource.meta?.replayFrames, !frames.isEmpty {
                let frame = frames[replayIndex % frames.count]
                view = try await DemoSource().route(route, frame: frame)
                replayLabel = "데모 재생 \(frame.prefix(2)):\(frame.suffix(2))"
                let wrapped = replayIndex % frames.count == 0
                replayIndex += 1
                guard self.route == route else { return }
                apply(view, animated: !wrapped && routeView != nil)
            } else {
                view = try await source.route(route)
                replayLabel = nil
                guard self.route == route else { return }
                apply(view, animated: routeView != nil)
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply(_ view: RouteView, animated: Bool) {
        if animated { withAnimation(.easeInOut(duration: 1.4)) { routeView = view } } else { routeView = view }
    }

    /// 정류장 화면: 예측, 오는 버스 위치, 추천, 지난 7일
    func refreshStop() async {
        guard let route, let stop else { return }
        isLoading = true
        defer { isLoading = false }
        let source = self.source
        do {
            async let p = source.predict(route: route, stationSeq: stop.stationSeq)
            async let l = source.line(route: route, stationSeq: stop.stationSeq)
            async let r = source.recommend(route: route, stationSeq: stop.stationSeq)
            async let h = source.history(route: route, stationSeq: stop.stationSeq)
            let (prediction, line, recommendation) = try await (p, l, r)
            guard self.stop?.stationSeq == stop.stationSeq, self.route == route else { return }
            self.prediction = prediction
            self.line = line
            self.recommendation = recommendation
            // 정류장 목록(전체 정류장, 다른 버스)과 도로 경로: 같은 시점의 최신으로 맞춘다
            if let view = try? await source.route(route), self.route == route { routeView = view }
            if geometry == nil, let path = try? await source.path(route: route), self.route == route { geometry = path }
            errorMessage = nil
            // 지난 7일은 서버에서 처음 계산할 때 오래 걸릴 수 있어 따로 받는다
            if let history = try? await h, self.stop?.stationSeq == stop.stationSeq { self.history = history }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
