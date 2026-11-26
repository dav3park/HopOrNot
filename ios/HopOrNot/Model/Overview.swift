import Foundation

/// 홈 화면의 노선 카드: 지금 달리는 버스들의 잔여석 요약 (GET /route 의 buses 에서 계산)
struct RouteSummary: Equatable {
    /// 노선 위 버스들의 지금 잔여석, 노선 순서(앞쪽 정류장부터)
    let seats: [Int]
    let updatedAt: Date

    init(view: RouteView) {
        seats = view.buses.sorted { $0.currentSeq < $1.currentSeq }.map(\.currentSeats)
        updatedAt = view.generatedAt
    }

    var running: Int { seats.count }
    var full: Int { seats.filter { $0 == 0 }.count }
    var low: Int { seats.filter { (1..<10).contains($0) }.count }
    var comfortable: Int { seats.filter { $0 >= 10 }.count }
    /// 만석이거나 자리가 적은 버스의 비율 (높을수록 붐빈다)
    var pressure: Double { running == 0 ? 0 : Double(full + low) / Double(running) }
}

/// 최근 본 정류장 (홈에서 바로 들어간다)
struct RecentStop: Codable, Identifiable, Hashable {
    let route: String
    let stationSeq: Int
    let stationName: String
    let direction: String?

    var id: String { "\(route)-\(stationSeq)" }
    var info: StopInfo { StopInfo(stationSeq: stationSeq, stationName: stationName, direction: direction, zone: nil) }
}
