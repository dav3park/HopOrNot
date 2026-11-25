import SwiftUI

/// 오는 버스 한 대: 몇 석 이상 남아 도착할 확률 + 이 버스까지 내가 탈 확률
struct BusCard: View {
    let route: Route
    let bus: Bus
    let order: Int
    let recommended: Bool

    private var seatLevels: [Int] { bus.isSimple ? [1, 20] : [1, 5, 10, 20] }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: "bus.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("\(Decision.ordinal(order)) 버스")
                            .font(.system(size: 16, weight: .bold))
                        if recommended {
                            Text("추천")
                                .font(.system(size: 10, weight: .bold))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .foregroundStyle(.white)
                                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 5))
                        }
                        Text(bus.plateShort).font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Text("\(bus.stopsAhead)정거장 전 · 약 \(bus.etaMinutes)분 · 지금 \(bus.currentSeats)석")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                if let byHere = bus.mySeatByHere {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(order == 0 ? "탈 확률" : "이 버스까지")
                            .font(.system(size: 10.5))
                            .foregroundStyle(.secondary)
                        Text(Format.percent(byHere))
                            .font(.system(size: 22, weight: .heavy))
                            .monospacedDigit()
                            .foregroundStyle(Theme.text(byHere))
                    }
                }
            }

            if let expected = bus.expectedSeats {
                HStack(spacing: 6) {
                    Image(systemName: "chair.fill").font(.system(size: 12)).foregroundStyle(.secondary)
                    Text("도착할 때 예상 잔여석").font(.system(size: 12.5)).foregroundStyle(.secondary)
                    Text("\(expected)석")
                        .font(.system(size: 17, weight: .heavy))
                        .monospacedDigit()
                        .foregroundStyle(Theme.seatText(expected))
                    if let range = bus.seatsRange, range.count == 2, range[0] != range[1] {
                        Text("(\(range[0])~\(range[1])석)").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
            }

            HStack(spacing: 6) {
                ForEach(seatLevels, id: \.self) { level in
                    if let p = bus.atLeast(level) {
                        SeatCell(label: "\(level)석 이상", p: p)
                    }
                }
            }
            if bus.isSimple {
                Text("아직 멀어서 1석·20석만 보여줍니다")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
            }
        }
        .card()
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(recommended ? Theme.accent : .clear, lineWidth: 1.5))
    }
}

/// 프로토타입의 좌석 표 칸: 확률만큼 옅은 색이 차고 아래에 막대
struct SeatCell: View {
    let label: String
    let p: Double

    var body: some View {
        VStack(spacing: 2) {
            Text(label).font(.system(size: 10.5, weight: .medium)).foregroundStyle(.secondary)
            Text(Format.percent(p))
                .font(.system(size: 15, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(Theme.text(p))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .background(alignment: .leading) {
            GeometryReader { geo in
                ZStack(alignment: .bottomLeading) {
                    Rectangle().fill(Theme.fill(p).opacity(0.16)).frame(width: geo.size.width * p)
                    Rectangle().fill(Theme.fill(p)).frame(width: geo.size.width * p, height: 3)
                }
            }
        }
        .background(Color(.tertiarySystemFill))
        .clipShape(RoundedRectangle(cornerRadius: 9))
        .accessibilityElement(children: .combine)
    }
}
