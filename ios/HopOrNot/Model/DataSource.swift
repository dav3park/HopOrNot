import Foundation

/// 앱이 쓰는 데이터. 추론 서버(Live) 또는 앱에 넣어 둔 과거 실제 데이터(Demo).
protocol DataSource: Sendable {
    func stops(route: Route) async throws -> [StopInfo]
    func route(_ route: Route) async throws -> RouteView
    func path(route: Route) async throws -> RoutePath
    func history(route: Route, stationSeq: Int) async throws -> History
    func predict(route: Route, stationSeq: Int) async throws -> Prediction
    func line(route: Route, stationSeq: Int) async throws -> LineView
    func recommend(route: Route, stationSeq: Int) async throws -> Recommendation
}

enum DataSourceError: LocalizedError {
    case missingDemo(String)
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .missingDemo(let name): "데모 데이터가 없습니다 (\(name))"
        case .server(let code, let message): "서버 오류 \(code): \(message)"
        }
    }
}

/// ml/serve/demo_fixtures.py 가 만든 Demo/*.json (그 시각에 서버가 냈을 응답과 같다)
struct DemoSource: DataSource {
    private func load<T: Decodable>(_ name: String) throws -> T {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json") else {
            throw DataSourceError.missingDemo(name)
        }
        return try JSON.decoder.decode(T.self, from: Data(contentsOf: url))
    }

    func stops(route: Route) async throws -> [StopInfo] { try load("stops_\(route.rawValue)") }
    func route(_ route: Route) async throws -> RouteView { try load("route_\(route.rawValue)") }
    func path(route: Route) async throws -> RoutePath { try load("path_\(route.rawValue)") }
    func history(route: Route, stationSeq: Int) async throws -> History { try load("history_\(route.rawValue)_\(stationSeq)") }
    /// 정류장 목록 재생용 장면 하나
    func route(_ route: Route, frame: String) async throws -> RouteView {
        try load("route_\(route.rawValue)_\(frame)")
    }
    func predict(route: Route, stationSeq: Int) async throws -> Prediction { try load("predict_\(route.rawValue)_\(stationSeq)") }
    func line(route: Route, stationSeq: Int) async throws -> LineView { try load("line_\(route.rawValue)_\(stationSeq)") }
    func recommend(route: Route, stationSeq: Int) async throws -> Recommendation { try load("recommend_\(route.rawValue)_\(stationSeq)") }

    static var meta: DemoMeta? {
        guard let url = Bundle.main.url(forResource: "demo_meta", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSON.decoder.decode(DemoMeta.self, from: data)
    }
}

/// FastAPI 추론 서버 (ml/serve/README.md)
struct LiveSource: DataSource {
    let baseURL: URL

    private func get<T: Decodable>(_ path: String, _ query: [String: String]) async throws -> T {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw DataSourceError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return try JSON.decoder.decode(T.self, from: data)
    }

    func stops(route: Route) async throws -> [StopInfo] { try await get("stops", ["route": route.rawValue]) }
    func route(_ route: Route) async throws -> RouteView { try await get("route", ["route": route.rawValue]) }
    func path(route: Route) async throws -> RoutePath { try await get("path", ["route": route.rawValue]) }
    func history(route: Route, stationSeq: Int) async throws -> History {
        try await get("history", ["route": route.rawValue, "station_seq": String(stationSeq)])
    }
    func predict(route: Route, stationSeq: Int) async throws -> Prediction {
        try await get("predict", ["route": route.rawValue, "station_seq": String(stationSeq)])
    }
    func line(route: Route, stationSeq: Int) async throws -> LineView {
        try await get("line", ["route": route.rawValue, "station_seq": String(stationSeq)])
    }
    func recommend(route: Route, stationSeq: Int) async throws -> Recommendation {
        try await get("recommend", ["route": route.rawValue, "station_seq": String(stationSeq)])
    }
}
