import Foundation

/// 추론 서버(ml/serve/app.py) 응답. 키는 snake_case → camelCase로 디코딩한다.

enum Route: String, CaseIterable, Identifiable, Codable {
    case m5107 = "M5107"
    case r5100 = "5100"
    case r1112 = "1112"

    var id: String { rawValue }
    var kind: String { self == .m5107 ? "광역급행 M" : "직행좌석" }
    var terminals: (String, String) {
        switch self {
        case .m5107: ("경희대학교", "서울역")
        case .r5100: ("경희대학교", "강남역")
        case .r1112: ("경희대학교", "강변역")
        }
    }
}

struct StopInfo: Codable, Identifiable, Hashable {
    let stationSeq: Int
    let stationName: String
    let direction: String?
    let zone: String?

    var id: Int { stationSeq }
    /// 내가 앉을 확률은 승차 구간에서만 나온다 (ml/src/waiting.py ZONES)
    var supportsMySeat: Bool { zone == "출발권" || zone == "서울권" }
}

/// 정류장 목록 화면: 한 방향의 정류장 전체와 지금 달리는 버스 (GET /route)
struct RouteView: Codable {
    let route: String
    let direction: String
    let generatedAt: Date
    let stops: [RouteStop]
    let buses: [RouteBus]
}

struct RouteStop: Codable, Identifiable, Hashable {
    let stationSeq: Int
    let stationName: String
    let lat: Double
    let lon: Double
    let isTarget: Bool
    let zone: String?
    var id: Int { stationSeq }
    var info: StopInfo { StopInfo(stationSeq: stationSeq, stationName: stationName, direction: nil, zone: zone) }
}

struct RouteBus: Codable, Identifiable {
    let vehId: Int
    let plateNo: String
    let currentSeq: Int
    /// 마지막으로 지난 곳 (고속도로 체크포인트 이름일 수 있다)
    let currentStationName: String?
    let stateCd: Int
    let currentSeats: Int
    var id: Int { vehId }
    var plateShort: String { String(plateNo.suffix(4)) }
    /// 정류장에 도착해 있음 (state_cd 1). 아니면 그 정류장을 지나 다음 정류장으로 가는 중
    var isAtStop: Bool { stateCd == 1 }
    /// "양재IC(경유)" → "양재IC"
    var placeShort: String { (currentStationName ?? "").replacingOccurrences(of: "(경유)", with: "") }
}

struct Prediction: Codable {
    let route: String
    let stationSeq: Int
    let stationName: String
    let direction: String?
    let zone: String?
    let generatedAt: Date
    let stale: Bool
    let buses: [Bus]
    let mySeat: MySeat?
}

struct Bus: Codable, Identifiable {
    let vehId: Int
    let plateNo: String
    let stopsAhead: Int
    let currentSeq: Int
    let currentStationName: String
    let stateCd: Int
    let currentSeats: Int
    let pAtLeast: [String: Double]
    let detail: String
    /// 이 버스까지(앞 버스들 포함) 내가 탈 확률. 가까운 몇 대만 있다.
    let mySeatByHere: Double?

    var id: Int { vehId }
    var isSimple: Bool { detail == "simple" }
    var plateShort: String { String(plateNo.suffix(4)) }
    func atLeast(_ seats: Int) -> Double? { pAtLeast[String(seats)] }
    /// 도착 시간은 모델로 예측하지 않는다. 정거장당 약 2분으로 어림한다 (ml/src/live.py BUS_MINUTES_PER_STOP).
    var etaMinutes: Int { max(1, stopsAhead * 2) }
}

struct MySeat: Codable {
    let probability: Double?
    let byBus: [Double]?
    let expectedPeopleAhead: Double?
    let minutesSincePreviousBus: Double?
    let previousBus: PreviousBus?
    let note: String?
}

struct PreviousBus: Codable {
    let buses: Int?
    let arrivalSeats: Double?
    let leftFull: Bool
}

struct LineView: Codable {
    let route: String
    let stationSeq: Int
    let direction: String?
    let generatedAt: Date
    let stops: [LineStop]
    let buses: [LineBus]
    /// [위도, 경도]. 경기버스 공식 지도의 도로 경로 (pathSource "gbis_road"), 없으면 정류장 사이 직선
    let path: [[Double]]
    let pathSource: String?
}

struct LineStop: Codable, Identifiable {
    let stationSeq: Int
    let stationName: String
    let lat: Double
    let lon: Double
    let isTarget: Bool
    let isMine: Bool
    var id: Int { stationSeq }
}

struct LineBus: Codable, Identifiable {
    let order: Int
    let vehId: Int
    let plateNo: String
    let currentSeq: Int
    let stateCd: Int
    let currentSeats: Int
    let lat: Double
    let lon: Double
    /// 정류장 순번(문자열) → 그 정류장에 1석 이상 남아 도착할 확률
    let pSeatAt: [String: Double]
    var id: Int { vehId }
    func pSeat(at seq: Int) -> Double? { pSeatAt[String(seq)] }
    /// 정류장에 도착해 있으면(state_cd 1) 그 정류장, 아니면 다음 정류장으로 가는 중
    var isAtStop: Bool { stateCd == 1 }
}

struct Recommendation: Codable {
    let route: String
    let stationSeq: Int
    let candidates: [Candidate]
}

struct Candidate: Codable, Identifiable {
    let stationSeq: Int
    let stationName: String
    let stopsFromMine: Int
    let distanceM: Int
    let walkMinutes: Int
    let busEtaMinutes: Int
    let reachable: Bool
    let mySeat: Double
    let isMine: Bool
    var id: Int { stationSeq }
}

struct DemoMeta: Codable {
    let generatedAt: Date
    let label: String
}

enum JSON {
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            for formatter in [fractional, plain] {
                if let date = formatter.date(from: text) { return date }
            }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "날짜 형식: \(text)"))
        }
        return decoder
    }()

    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()
}
