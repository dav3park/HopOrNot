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

/// 정류장 목록 화면: 노선 한 바퀴(캠퍼스 → 서울 → 캠퍼스)를 한 줄로, 지금 달리는 버스 전부 (GET /route)
struct RouteView: Codable {
    let route: String
    let generatedAt: Date
    /// 회차 지점 순번 (서울 끝)
    let turnSeq: Int
    let stops: [RouteStop]
    let buses: [RouteBus]
}

struct RouteStop: Codable, Identifiable, Hashable {
    let stationSeq: Int
    let stationName: String
    let lat: Double
    let lon: Double
    /// stop 승하차 정류장 / highway 고속도로 구간(IC·JC·TG 이름) / via 도심 경유 지점 / campus 경희대 안쪽
    let kind: String
    let isTarget: Bool
    let zone: String?
    /// 서울행 / 영통행 (예측 대상 정류장만)
    let direction: String?

    var id: Int { stationSeq }
    var isHighway: Bool { kind == "highway" }
    var isVia: Bool { kind == "via" }
    /// 문이 열리지 않는 지점 (고속도로, 도심 경유)
    var isPassThrough: Bool { isHighway || isVia }
    /// "양재IC(경유)" → "양재IC"
    var displayName: String { stationName.replacingOccurrences(of: "(경유)", with: "") }
    var info: StopInfo { StopInfo(stationSeq: stationSeq, stationName: stationName, direction: direction, zone: zone) }
}

struct RouteBus: Codable, Identifiable {
    let vehId: Int
    let plateNo: String
    let currentSeq: Int
    let stateCd: Int
    let currentSeats: Int
    let lat: Double
    let lon: Double
    var id: Int { vehId }
    var plateShort: String { String(plateNo.suffix(4)) }
    /// 정류장에 도착해 있음 (state_cd 1). 아니면 그 정류장을 지나 다음 정류장으로 가는 중
    var isAtStop: Bool { stateCd == 1 }
}

/// 지도용 도로 경로 (GET /path). 고속도로는 따로 나눠서 회색으로 그린다.
struct RoutePath: Codable {
    let route: String
    let source: String
    let segments: [PathSegment]
}

struct PathSegment: Codable {
    let kind: String   // road / highway
    let points: [[Double]]   // [위도, 경도]
    var isHighway: Bool { kind == "highway" }
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
    /// 내 정류장에 도착할 때 예상 잔여석 (중앙값)과 10–90% 범위
    let expectedSeats: Int?
    let seatsRange: [Int]?

    var id: Int { vehId }
    var isSimple: Bool { detail == "simple" }
    var plateShort: String { String(plateNo.suffix(4)) }
    func atLeast(_ seats: Int) -> Double? { pAtLeast[String(seats)] }
    /// 도착 시간은 모델로 예측하지 않는다. 정거장당 약 2분으로 어림한다 (ml/src/live.py BUS_MINUTES_PER_STOP).
    var etaMinutes: Int { max(1, stopsAhead * 2) }
    var expectedText: String? {
        guard let expectedSeats else { return nil }
        guard let range = seatsRange, range.count == 2, range[0] != range[1] else { return "예상 \(expectedSeats)석" }
        return "예상 \(expectedSeats)석 (\(range[0])~\(range[1]))"
    }
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

/// 내 정류장으로 오는 버스들 (GET /line). 정류장 목록과 도로 경로는 RouteView, RoutePath에 있다.
struct LineView: Codable {
    let route: String
    let stationSeq: Int
    let direction: String?
    let generatedAt: Date
    let buses: [LineBus]
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
    /// 정류장 목록 재생용 장면 (HHmm)
    let replayFrames: [String]?
}

/// 지난 7일 이 정류장 도착 잔여석, 30분 단위 (GET /history)
struct History: Codable {
    let route: String
    let stationSeq: Int
    let slotMinutes: Int
    let days: [HistoryDay]
    let cells: [HistoryCell]
    let summary: [HistorySlot]
}

struct HistoryDay: Codable, Hashable {
    let day: String       // 2026-11-19
    let dayType: String   // 평일 / 토요일 / 일요일·공휴일
}

struct HistoryCell: Codable {
    let day: String
    let slot: Int         // 하루 시작부터 분 (자정 넘으면 1440 이상)
    let buses: Int
    let meanSeats: Double
    let share: Double
    let allBoarded: Double?
}

struct HistorySlot: Codable {
    let dayType: String
    let slot: Int
    let buses: Int
    let medianSeats: Double
    /// 도착할 때 1석 이상 남은 비율
    let share: Double
    /// 만석으로 떠나지 않은(기다린 사람이 다 탄) 비율. 떠날 때 잔여석을 아는 버스가 3대 미만이면 nil
    let allBoarded: Double?
    var boardable: Double { allBoarded ?? share }
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
