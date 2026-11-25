import Foundation

/// 정류장 화면 맨 위 "AI 판단" 카드의 내용.
///
/// 서버가 주는 `my_seat_by_here`(k번째 버스까지 내가 탈 확률)로 정한다. 앞 버스를 못 타면 그 버스 좌석만큼
/// 내 앞 인원이 줄어드는 것까지 반영된 값이다 (ml/src/live.py my_seat_probability).
struct Decision {
    let headline: String
    let detail: String
    let probability: Double?
    let probabilityLabel: String
    let recommendedOrder: Int?
    let alternative: String?
    let alternativeSeq: Int?

    static let threshold = 0.7

    static func ordinal(_ order: Int) -> String {
        switch order {
        case 0: "이번"
        case 1: "다음"
        default: "\(order + 1)번째"
        }
    }

    init(prediction: Prediction?, recommendation: Recommendation?, stop: StopInfo?) {
        guard let prediction, let first = prediction.buses.first else {
            self.init(headline: "오는 버스 없음", detail: "잠시 후 다시 예측합니다", probability: nil,
                      probabilityLabel: "탈 확률", recommendedOrder: nil, alternative: nil, alternativeSeq: nil)
            return
        }
        let byBus = prediction.mySeat?.byBus ?? []
        let ahead = prediction.mySeat?.expectedPeopleAhead.map { " · 예상 내 앞 \(Int($0.rounded()))명" } ?? ""

        guard !byBus.isEmpty else {
            // 내가 앉을 확률은 승차 구간에서만 나온다. 그 밖에서는 버스에 자리가 남을 확률로 안내한다.
            let p = first.atLeast(1) ?? 0
            self.init(headline: p >= Self.threshold ? "이번 버스에 자리 있음" : "이번 버스는 붐빔",
                      detail: "약 \(first.etaMinutes)분 후 도착 · 이 정류장은 줄 선 인원을 추정하지 않음",
                      probability: p, probabilityLabel: "1석 이상", recommendedOrder: 0,
                      alternative: nil, alternativeSeq: nil)
            return
        }

        let buses = prediction.buses
        let order = byBus.firstIndex { $0 >= Self.threshold }
        let headline: String, detail: String, probability: Double
        switch order {
        case 0:
            headline = "이번 버스 타세요"
            detail = "약 \(first.etaMinutes)분 후 도착\(ahead)"
            probability = byBus[0]
        case let k?:
            headline = "\(k)대 보내고 \(Self.ordinal(k)) 버스"
            let eta = k < buses.count ? buses[k].etaMinutes : first.etaMinutes
            detail = "이번 버스는 \(Format.percent(byBus[0])) · 약 \(eta)분 후\(ahead)"
            probability = byBus[k]
        case nil:
            let best = byBus.indices.max { byBus[$0] < byBus[$1] } ?? 0
            headline = "오는 버스 모두 자리 부족 예상"
            detail = "\(Self.ordinal(best)) 버스까지 기다려도 \(Format.percent(byBus[best]))\(ahead)"
            probability = byBus[best]
        }

        var alternative: String? = nil
        var alternativeSeq: Int? = nil
        let mine = byBus[0]
        if let candidates = recommendation?.candidates {
            if let better = candidates.first(where: { !$0.isMine && $0.reachable && $0.mySeat >= mine + 0.1 }) {
                let way = better.stopsFromMine < 0 ? "\(-better.stopsFromMine)정거장 거슬러" : "\(better.stopsFromMine)정거장 앞으로"
                alternative = "또는 \(better.stationName)까지 \(way) 걸어가면 \(Format.percent(better.mySeat)) (도보 \(better.walkMinutes)분)"
                alternativeSeq = better.stationSeq
            } else if candidates.count > 1 {
                alternative = "걸어갈 수 있는 가까운 정류장 중 여기가 가장 유리"
            }
        }
        self.init(headline: headline, detail: detail, probability: probability, probabilityLabel: "탈 확률",
                  recommendedOrder: order, alternative: alternative, alternativeSeq: alternativeSeq)
    }

    private init(headline: String, detail: String, probability: Double?, probabilityLabel: String,
                 recommendedOrder: Int?, alternative: String?, alternativeSeq: Int?) {
        self.headline = headline
        self.detail = detail
        self.probability = probability
        self.probabilityLabel = probabilityLabel
        self.recommendedOrder = recommendedOrder
        self.alternative = alternative
        self.alternativeSeq = alternativeSeq
    }
}

enum Format {
    static func percent(_ p: Double) -> String { "\(Int((p * 100).rounded()))%" }

    static let time: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "HH:mm"
        return f
    }()
}
