import Foundation
import Observation
import SwiftUI

/// 화면 이동: 홈(노선 선택) → 정류장 목록(노선 한 바퀴) → 정류장
enum Screen: Hashable {
    case route(Route)
    case station
}

/// 앱 상태.
///
/// 네트워크 요청은 화면(.task)의 생명주기와 상관없이 끝까지 실행한다 (화면이 바뀌거나 당겨서 새로고침하다 요청이
/// 취소되는 일을 막는다). 대신 요청마다 번호를 붙여, 더 새로운 요청이 시작됐으면 오래된 응답은 버린다.
/// 취소는 오류가 아니므로 화면에 보여 주지 않는다. 실패해도 마지막으로 받은 데이터는 남긴다.
@MainActor
@Observable
final class AppModel {
    enum Mode: String, CaseIterable, Identifiable {
        case demo, live
        var id: String { rawValue }
        var label: String { self == .demo ? "데모 (과거 실제 데이터)" : "추론 서버" }
    }

    // 설정 (UserDefaults에 남긴다)
    var mode: Mode { didSet { defaults.set(mode.rawValue, forKey: "mode"); resetData() } }
    var serverURL: String { didSet { defaults.set(serverURL, forKey: "serverURL") } }
    /// 추론 서버 접근 키 (서버 .env 의 API_KEY)
    var apiKey: String { didSet { defaults.set(apiKey, forKey: "apiKey") } }

    var path: [Screen] = []
    private(set) var route: Route?
    private(set) var stop: StopInfo?
    private(set) var recents: [RecentStop] = []

    // 홈: 노선별 요약
    private(set) var overview: [Route: RouteSummary] = [:]
    private(set) var overviewStatus: LoadStatus = .idle
    // 정류장 목록·지도 데이터 (노선마다 한 번)
    private(set) var routeView: RouteView?
    private(set) var geometry: RoutePath?
    private(set) var routeStatus: LoadStatus = .idle
    private(set) var replayLabel: String?
    // 정류장 화면 데이터
    private(set) var prediction: Prediction?
    private(set) var line: LineView?
    private(set) var recommendation: Recommendation?
    private(set) var history: History?
    private(set) var stopStatus: LoadStatus = .idle

    private let defaults = UserDefaults.standard
    private var replayIndex = 0
    private var routeGeneration = 0
    private var stopGeneration = 0
    private var overviewGeneration = 0

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
        if let data = defaults.data(forKey: "recents"), let saved = try? JSONDecoder().decode([RecentStop].self, from: data) {
            recents = saved
        }
        #if DEBUG
        let launch = ProcessInfo.processInfo.arguments
        func value(_ flag: String) -> [String]? {
            guard let i = launch.firstIndex(of: flag), i + 1 < launch.count else { return nil }
            return launch[i + 1].split(separator: ",", omittingEmptySubsequences: false).map(String.init)
        }
        // 개발용: -live URL,KEY 로 실서버 모드로 시작
        if let parts = value("-live") {
            mode = .live
            serverURL = parts[0]
            if parts.count > 1, !parts[1].isEmpty { apiKey = parts[1] }
        }
        // 개발용: -selectStop M5107,36,광교 (정류장 화면으로 시작), -openRoute M5107 (정류장 목록으로 시작)
        if let parts = value("-selectStop"), parts.count == 3, let route = Route(rawValue: parts[0]), let seq = Int(parts[1]) {
            self.route = route
            stop = StopInfo(stationSeq: seq, stationName: parts[2], direction: nil, zone: nil)
            pushStation(after: route)
        } else if let parts = value("-openRoute"), parts.count == 1, let route = Route(rawValue: parts[0]) {
            self.route = route
            path = [.route(route)]
        }
        #endif
    }

    #if DEBUG
    /// 개발용: -autoStation 36,광교,0.8 → 0.8초 뒤 정류장 화면으로 넘어간다 (목록의 요청이 취소되는 상황 재현)
    func debugAutoStation() {
        let launch = ProcessInfo.processInfo.arguments
        guard let i = launch.firstIndex(of: "-autoStation"), i + 1 < launch.count else { return }
        let parts = launch[i + 1].split(separator: ",").map(String.init)
        guard parts.count == 3, let seq = Int(parts[0]), let delay = Double(parts[2]) else { return }
        Task {
            try? await Task.sleep(for: .seconds(delay))
            openStation(StopInfo(stationSeq: seq, stationName: parts[1], direction: nil, zone: nil))
        }
    }

    /// 개발용: -autoSwitch 27,0.8,국가인권위 → 0.8초 뒤 추천 정류장을 누른 것처럼 정류장을 바꾼다 (진행 중인 요청이 취소되는 상황 재현)
    func debugAutoSwitch() {
        let launch = ProcessInfo.processInfo.arguments
        guard let i = launch.firstIndex(of: "-autoSwitch"), i + 1 < launch.count else { return }
        let parts = launch[i + 1].split(separator: ",").map(String.init)
        guard parts.count == 3, let seq = Int(parts[0]), let delay = Double(parts[1]) else { return }
        Task {
            try? await Task.sleep(for: .seconds(delay))
            changeStop(StopInfo(stationSeq: seq, stationName: parts[2], direction: nil, zone: nil))
            await refreshStop()
        }
    }
    #endif

    /// 오전에는 출근(서울행), 오후에는 퇴근(영통행): 정류장 목록을 처음 열 때 이쪽 정류장으로 스크롤한다
    static var defaultDirection: String { Calendar.current.component(.hour, from: .now) < 13 ? "서울행" : "영통행" }

    var source: DataSource {
        switch mode {
        case .demo: DemoSource()
        case .live: LiveSource(baseURL: URL(string: serverURL) ?? URL(string: "https://54-116-10-20.sslip.io")!, apiKey: apiKey)
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
        routeStatus = .idle
        replayIndex = 0
        clearStopData()
    }

    /// 정류장 목록에서 정류장을 누르면 정류장 화면으로
    func openStation(_ stop: StopInfo) {
        if stop.stationSeq != self.stop?.stationSeq { changeStop(stop) }
        remember(stop)
        path.append(.station)
    }

    /// 홈의 "최근 본 정류장"에서 바로 정류장 화면으로
    func openRecent(_ recent: RecentStop) {
        guard let route = Route(rawValue: recent.route) else { return }
        open(route)
        if stop?.stationSeq != recent.stationSeq { changeStop(recent.info) }
        remember(recent.info)
        pushStation(after: route)
    }

    /// 한 번에 두 화면을 쌓으면 빈 화면이 나오므로, 정류장 목록을 먼저 띄우고 잠시 뒤 정류장 화면을 올린다
    private func pushStation(after route: Route) {
        path = [.route(route)]
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            if path == [.route(route)] { path.append(.station) }
        }
    }

    /// 정류장 화면 안에서 추천 정류장으로 바꿀 때
    func switchStop(to seq: Int) async {
        guard let target = routeView?.stops.first(where: { $0.stationSeq == seq }) else { return }
        changeStop(target.info)
        remember(target.info)
        await refreshStop()
    }

    /// 정류장을 바꾼다: 이전 정류장의 데이터와 오류를 비우고 로딩 상태로 만든다
    private func changeStop(_ new: StopInfo) {
        stop = new
        clearStopData()
        stopStatus = .loading
        stopGeneration += 1   // 이전 정류장의 늦은 응답은 버린다
    }

    private func remember(_ stop: StopInfo) {
        guard let route else { return }
        let item = RecentStop(route: route.rawValue, stationSeq: stop.stationSeq, stationName: stop.stationName, direction: stop.direction)
        recents = Array(([item] + recents.filter { $0.id != item.id }).prefix(6))
        defaults.set(try? JSONEncoder().encode(recents), forKey: "recents")
    }

    private func clearStopData() {
        prediction = nil
        line = nil
        recommendation = nil
        history = nil
        stopStatus = .idle
    }

    /// 데이터 출처(데모/서버)를 바꾸면 받아 둔 것을 모두 비운다
    private func resetData() {
        overview = [:]
        overviewStatus = .idle
        routeView = nil
        geometry = nil
        routeStatus = .idle
        replayIndex = 0
        overviewGeneration += 1
        routeGeneration += 1
        clearStopData()
    }

    // MARK: 불러오기

    /// 화면이 끝나도 취소되지 않는 독립 작업으로 실행한다 (구조적 동시성의 취소가 전파되지 않는다)
    private func detached<T: Sendable>(_ work: @escaping @MainActor () async throws -> T) async -> Result<T, Error> {
        await Task { @MainActor in
            do { return .success(try await work()) } catch { return .failure(error) }
        }.value
    }

    /// 홈: 노선 세 개의 지금 상태 요약
    func refreshOverview() async {
        overviewGeneration += 1
        let generation = overviewGeneration
        if overview.isEmpty { overviewStatus = .loading }
        let source = self.source
        let results = await detached { () -> [Route: RouteView] in
            try await withThrowingTaskGroup(of: (Route, RouteView).self) { group in
                for route in Route.allCases { group.addTask { (route, try await source.route(route)) } }
                var views: [Route: RouteView] = [:]
                for try await (route, view) in group { views[route] = view }
                return views
            }
        }
        guard generation == overviewGeneration else { return }
        switch results {
        case .success(let views):
            overview = views.mapValues(RouteSummary.init)
            overviewStatus = .ok(.now)
        case .failure(let error):
            if AppError.isCancellation(error) { return }
            overviewStatus = .failed(AppError(error))
        }
    }

    /// 정류장 목록. 버스 위치가 바뀌면 레일 위에서 움직이도록 애니메이션으로 바꾼다.
    /// 데모는 저장해 둔 2분 간격 장면을 차례로 보여준다 (재생).
    func refreshRoute() async {
        guard let route else { return }
        routeGeneration += 1
        let generation = routeGeneration
        if routeView == nil { routeStatus = .loading }
        let source = self.source
        let frames = mode == .demo ? (DemoSource.meta?.replayFrames ?? []) : []
        let frame = frames.isEmpty ? nil : frames[replayIndex % frames.count]
        let result = await detached { () -> RouteView in
            if let frame { return try await DemoSource().route(route, frame: frame) }
            return try await source.route(route)
        }
        guard generation == routeGeneration, self.route == route else { return }
        switch result {
        case .success(let view):
            let wrapped = frame != nil && replayIndex % frames.count == 0
            if frame != nil { replayIndex += 1; replayLabel = "데모 재생 \(frame!.prefix(2)):\(frame!.suffix(2))" } else { replayLabel = nil }
            if routeView != nil && !wrapped { withAnimation(.easeInOut(duration: 1.4)) { routeView = view } } else { routeView = view }
            routeStatus = .ok(.now)
        case .failure(let error):
            if AppError.isCancellation(error) { return }
            routeStatus = .failed(AppError(error))
        }
    }

    /// 정류장 화면: 예측, 오는 버스 위치, 추천, 지난 7일
    func refreshStop() async {
        guard let route, let stop else { return }
        stopGeneration += 1
        let generation = stopGeneration
        if prediction == nil { stopStatus = .loading }
        let source = self.source
        let result = await detached { () -> (Prediction, LineView, Recommendation, RouteView?, RoutePath?) in
            async let p = source.predict(route: route, stationSeq: stop.stationSeq)
            async let l = source.line(route: route, stationSeq: stop.stationSeq)
            async let r = source.recommend(route: route, stationSeq: stop.stationSeq)
            let (prediction, line, recommendation) = try await (p, l, r)
            // 정류장 목록(전체 정류장, 다른 버스)과 도로 경로는 부가 정보라 실패해도 화면을 막지 않는다
            let view = try? await source.route(route)
            let geometry = try? await source.path(route: route)
            return (prediction, line, recommendation, view, geometry)
        }
        guard generation == stopGeneration, self.stop?.stationSeq == stop.stationSeq, self.route == route else { return }
        switch result {
        case .success(let (prediction, line, recommendation, view, geometry)):
            self.prediction = prediction
            self.line = line
            self.recommendation = recommendation
            if let view { routeView = view }
            if self.geometry == nil, let geometry { self.geometry = geometry }
            stopStatus = .ok(.now)
            // 지난 7일은 서버에서 처음 계산할 때 오래 걸릴 수 있어 따로 받는다
            Task { @MainActor in
                if let history = try? await source.history(route: route, stationSeq: stop.stationSeq),
                   self.stop?.stationSeq == stop.stationSeq { self.history = history }
            }
        case .failure(let error):
            if AppError.isCancellation(error) { return }
            stopStatus = .failed(AppError(error))
        }
    }
}
