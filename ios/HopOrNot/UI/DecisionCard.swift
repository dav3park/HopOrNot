import SwiftUI

/// 맨 위 "AI 판단" 카드: 탈지 보낼지 + 실제로 탈 확률 + 더 유리한 정류장
struct DecisionCard: View {
    let decision: Decision
    let stopName: String
    let nextBusMinutes: Int?
    var onAlternative: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("내 정류장 · \(stopName) · \(nextBusMinutes.map { "다음 버스 약 \($0)분" } ?? "오는 버스 없음")")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("AI 판단")
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .foregroundStyle(Theme.accent)
                    .background(Color(hex: 0xEAF1FB), in: RoundedRectangle(cornerRadius: 5))
            }

            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(decision.headline)
                        .font(.system(size: 22, weight: .heavy))
                        .tracking(-0.4)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(decision.detail)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(decision.probabilityLabel)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Text(decision.probability.map(Format.percent) ?? "–")
                        .font(.system(size: 34, weight: .heavy))
                        .tracking(-0.6)
                        .monospacedDigit()
                        .foregroundStyle(decision.probability.map(Theme.text) ?? .secondary)
                }
            }

            if let alternative = decision.alternative {
                Divider()
                Button {
                    onAlternative?()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "figure.walk")
                            .font(.system(size: 14, weight: .semibold))
                        Text(alternative)
                            .font(.system(size: 13))
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                        if decision.alternativeSeq != nil {
                            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
                .disabled(decision.alternativeSeq == nil)
            }
        }
        .card()
        .accessibilityElement(children: .combine)
    }
}
