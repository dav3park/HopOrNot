import SwiftUI

/// 고정된 AI 판단을 누르면 올라오는 상세: 판단 + 오는 버스별 좌석 확률 + 탈 확률 높은 정류장
struct StationDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let decision = model.decision
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                DecisionCard(decision: decision, stopName: model.stop?.stationName ?? "",
                             nextBusMinutes: model.prediction?.buses.first?.etaMinutes) {
                    if let seq = decision.alternativeSeq {
                        model.select(stationSeq: seq)
                        dismiss()
                    }
                }

                if let route = model.route, let prediction = model.prediction, !prediction.buses.isEmpty {
                    Text("오는 버스").font(.system(size: 17, weight: .bold)).padding(.horizontal, 4)
                    ForEach(Array(prediction.buses.prefix(5).enumerated()), id: \.element.id) { order, bus in
                        BusCard(route: route, bus: bus, order: order, recommended: order == decision.recommendedOrder)
                    }
                    ProbabilityLegend().frame(maxWidth: .infinity)
                }

                if let route = model.route, let recommendation = model.recommendation, recommendation.candidates.count > 1 {
                    RecommendCard(route: route, recommendation: recommendation) { seq in
                        model.select(stationSeq: seq)
                        dismiss()
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background)
    }
}
